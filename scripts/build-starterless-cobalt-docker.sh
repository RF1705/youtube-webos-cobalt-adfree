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

# The starterless Shorts port does not rebuild SDL. Reuse the already prepared
# webOS SDL bundle containing the existing lifecycle/SIGCONT changes.
if [[ ! -d "$sdl_root/include/SDL2" || ! -f "$sdl_root/lib/libSDL2.a" ]]; then
  echo "Missing prebuilt patched SDL-webOS bundle: $sdl_root" >&2
  echo "Restore the existing starterless SDL bundle or set SDL2_BUNDLE_DIR." >&2
  echo "SDL does not need to be rebuilt for the Shorts preload change." >&2
  exit 2
fi
if [[ ! -f "$sdl_root/include/SDL2/SDL_config.h" ]]; then
  echo "SDL bundle is missing SDL_config.h: $sdl_root" >&2
  exit 2
fi
if ! grep -Eq '^#define SDL_WEBOS_BROKEN_ABI[[:space:]]+1$' "$sdl_root/include/SDL2/SDL_config.h"; then
  echo "SDL bundle does not enable SDL_WEBOS_BROKEN_ABI: $sdl_root" >&2
  exit 2
fi
if ! grep -Eq '^#define SDL_VIDEO_DRIVER_WAYLAND_WEBOS[[:space:]]+1$' "$sdl_root/include/SDL2/SDL_config.h"; then
  echo "SDL bundle does not enable the webOS Wayland backend: $sdl_root" >&2
  exit 2
fi

echo "Using existing patched SDL-webOS bundle: $sdl_root"
echo "Building webOS VP9/AV1 codec bundles."
COBALT_SOURCE_DIR="$cobalt_root" \
WEBOS_LINUX_SDK_VOLUME="$sdk_volume" \
VPX_PARALLEL="$parallel" \
DAV1D_PARALLEL="$parallel" \
  "$repo_root/scripts/build-webos-video-codecs-docker.sh"

echo "Building YTAF web assets."
make -C "$repo_root" docker-make.npm

# Add only the normal YTAF integration plus the isolated early-preload hook.
# Existing starterless Starboard, UHD/HDR, Starfish and lifecycle patches stay
# untouched and are installed through the existing platform installer.
bash "$repo_root/scripts/install-ytaf-cobalt-assets.sh" "$cobalt_root"
"$repo_root/scripts/install-webos-starboard-platform.sh" "$cobalt_root"
mkdir -p "$(dirname "$build_log")"

# Force GN/Ninja to refresh only the generated adblock content while keeping the
# existing compiled Cobalt objects for an incremental rebuild.
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
# Gold builds compile out non-fatal logging, so verify the runtime path literal
# used by ReadYtafPreloadScript instead of a LOG(INFO) message. Search the
# binary directly to avoid strings|grep -q interacting badly with pipefail.
if ! grep -aFq '/web/adblock/adblockPreload.js' "$cobalt_binary"; then
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
