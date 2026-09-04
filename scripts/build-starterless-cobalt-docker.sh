#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cobalt_root="${COBALT_SOURCE_DIR:-$repo_root/workdir/cobalt-23.lts.6}"
sdl_root="${SDL2_BUNDLE_DIR:-$repo_root/workdir/deps/SDL2-2.30.12-webos-abi}"
sdk_volume="${WEBOS_LINUX_SDK_VOLUME:-ytaf-webos-linux-sdk}"
build_type="${COBALT_BUILD_TYPE:-devel}"
parallel="${NINJA_PARALLEL:-4}"
out_dir="out/webos-arm-sbversion-13_${build_type}"
build_log="${COBALT_BUILD_LOG:-$repo_root/output/starterless-cobalt-${build_type}.log}"

if ! docker volume inspect "$sdk_volume" >/dev/null 2>&1; then
  echo "Missing Docker SDK volume: $sdk_volume" >&2
  exit 3
fi

# The default SDL bundle is built from the pinned webOSbrew SDL source with the
# lifecycle SIGCONT patch. An explicitly supplied SDL2_BUNDLE_DIR remains an
# escape hatch for development or compatibility testing.
if [[ -z "${SDL2_BUNDLE_DIR:-}" ]]; then
  SDL2_BUNDLE_DIR="$sdl_root" \
  WEBOS_LINUX_SDK_VOLUME="$sdk_volume" \
    "$repo_root/scripts/build-sdl-webos-docker.sh"
fi

if [[ ! -d "$sdl_root/include/SDL2" || ! -f "$sdl_root/lib/libSDL2.a" ]]; then
  echo "SDL2_BUNDLE_DIR does not contain a usable webOS SDL static bundle: $sdl_root" >&2
  exit 2
fi

echo "Building YTAF web assets."
make -C "$repo_root" docker-make.npm

# Apply the normal YTAF Cobalt patch and the isolated early-preload extension
# before installing the starterless platform patches. This keeps a fresh Cobalt
# checkout reproducible and avoids applying the base patch over Starfish/UHD
# source changes afterwards.
bash "$repo_root/scripts/install-ytaf-cobalt-assets.sh" "$cobalt_root"
"$repo_root/scripts/install-webos-starboard-platform.sh" "$cobalt_root"
mkdir -p "$(dirname "$build_log")"

# An incremental GN build can otherwise retain the copied web assets from an
# older starterless build. Remove only that generated directory so Ninja must
# recreate it from the current webapp/output without throwing away compiled
# Cobalt objects.
rm -rf "$cobalt_root/$out_dir/content/web/adblock"

echo "Starting the long Cobalt webos-arm build with $parallel jobs."
echo "Complete build log: $build_log"
docker run --rm --platform linux/amd64 \
  -v "$cobalt_root:/code" \
  -v "$sdk_volume:/sdk" \
  -v "$sdl_root:/sdl:ro" \
  -w /code \
  -e PYTHONPATH=/code \
  -e WEBOS_SDK_ROOT=/sdk/arm-webos-linux-gnueabi_sdk-buildroot \
  -e SDL2_BUNDLE_DIR=/sdl \
  cobalt-build-evergreen:latest \
  sh -c "git config --global --add safe.directory /code && gn --script-executable=python3 gen '$out_dir' --args='target_platform=\"webos-arm\" build_type=\"$build_type\" target_cpu=\"arm\" sb_api_version=13 is_clang=false' && ninja -v -j '$parallel' -C '$out_dir' cobalt" \
  2>&1 | tee "$build_log"

cobalt_binary="$cobalt_root/$out_dir/cobalt"
adblock_output="$cobalt_root/$out_dir/content/web/adblock"

if [[ ! -x "$cobalt_binary" ]]; then
  echo "Starterless Cobalt binary was not produced: $cobalt_binary" >&2
  exit 5
fi
if ! strings "$cobalt_binary" | grep -Fq '[YTAF] Executing early preload from'; then
  echo "Starterless Cobalt binary does not contain the YTAF early preload hook." >&2
  echo "Refusing to use a stale binary." >&2
  exit 6
fi
for asset in adblockMain.js adblockMain.css adblockPreload.js; do
  if [[ ! -s "$adblock_output/$asset" ]]; then
    echo "Starterless Cobalt output is missing current web asset: $adblock_output/$asset" >&2
    exit 7
  fi
done
if ! grep -Fq '__shorts' "$adblock_output/adblockMain.js"; then
  echo "Starterless adblockMain.js does not contain the Shorts UI." >&2
  exit 8
fi
if ! grep -Fq '__ytafPreloadExecuted' "$adblock_output/adblockPreload.js"; then
  echo "Starterless adblockPreload.js does not contain the early Shorts hook." >&2
  exit 9
fi

echo "Verified current YTAF preload and Shorts assets in starterless output."
echo "Cobalt binary: $cobalt_binary"
