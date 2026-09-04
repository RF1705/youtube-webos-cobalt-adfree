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

for asset in adblockPreload.js adblockMain.js adblockMain.css; do
  if [[ ! -s "$repo_root/webapp/output/$asset" ]]; then
    echo "Missing YTAF web asset: $repo_root/webapp/output/$asset" >&2
    exit 5
  fi
done

"$repo_root/scripts/install-webos-starboard-platform.sh" "$cobalt_root"
mkdir -p "$cobalt_root/cobalt/adblock/content"
cp -R "$repo_root/webapp/output/." "$cobalt_root/cobalt/adblock/content/"
mkdir -p "$(dirname "$build_log")"

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

echo "Cobalt binary: $cobalt_root/$out_dir/cobalt"
