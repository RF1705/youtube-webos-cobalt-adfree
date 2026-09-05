#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sdl_repo="${SDL2_WEBOS_REPOSITORY:-https://github.com/webosbrew/SDL-webOS.git}"
sdl_ref="${SDL2_WEBOS_REF:-263629dab0c89e75f9872eed66e197174952ce02}"
sdl_version="${SDL2_WEBOS_VERSION:-2.30.12}"
source_dir="${SDL2_SOURCE_DIR:-$repo_root/workdir/deps/SDL-webOS-$sdl_version-src}"
build_dir="${SDL2_BUILD_DIR:-$repo_root/workdir/deps/SDL-webOS-$sdl_version-build}"
bundle_dir="${SDL2_BUNDLE_DIR:-$repo_root/workdir/deps/SDL2-$sdl_version-webos-abi}"
patch_file="$repo_root/cobalt-platform/SDL-webOS-2.30.12-relaunch-sigcont.patch"
parallel="${SDL2_BUILD_PARALLEL:-${NINJA_PARALLEL:-4}}"
docker_image="${COBALT_BUILD_DOCKER_IMAGE:-cobalt-build-evergreen:latest}"
force_rebuild="${SDL2_FORCE_REBUILD:-0}"
stamp_file="$bundle_dir/.ytaf-sdl-build"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256sum or shasum is required" >&2
    return 1
  fi
}

if [[ ! -f "$patch_file" ]]; then
  echo "Missing SDL lifecycle patch: $patch_file" >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git is required to prepare SDL-webOS." >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build SDL-webOS." >&2
  exit 2
fi

patch_sha256="$(sha256_file "$patch_file")"

bundle_is_current() {
  [[ -f "$bundle_dir/lib/libSDL2.a" ]] || return 1
  [[ -f "$bundle_dir/include/SDL2/SDL.h" ]] || return 1
  [[ -f "$bundle_dir/include/SDL2/SDL_config.h" ]] || return 1
  [[ -f "$stamp_file" ]] || return 1
  grep -Fqx "version=$sdl_version" "$stamp_file" || return 1
  grep -Fqx "source_repository=$sdl_repo" "$stamp_file" || return 1
  grep -Fqx "source_ref=$sdl_ref" "$stamp_file" || return 1
  grep -Fqx "patch_sha256=$patch_sha256" "$stamp_file" || return 1
  grep -Eq '^#define SDL_WEBOS_BROKEN_ABI[[:space:]]+1$' \
    "$bundle_dir/include/SDL2/SDL_config.h" || return 1
  grep -Eq '^#define SDL_VIDEO_DRIVER_WAYLAND_WEBOS[[:space:]]+1$' \
    "$bundle_dir/include/SDL2/SDL_config.h" || return 1
}

if [[ "$force_rebuild" != "1" ]] && bundle_is_current; then
  echo "Patched SDL-webOS bundle is current: $bundle_dir"
  exit 0
fi

sdk_volume="${WEBOS_LINUX_SDK_VOLUME:-ytaf-webos-linux-sdk}"
if ! docker volume inspect "$sdk_volume" >/dev/null 2>&1; then
  echo "Missing Docker SDK volume: $sdk_volume" >&2
  exit 3
fi
toolchain_file="/sdk/arm-webos-linux-gnueabi_sdk-buildroot/share/buildroot/toolchainfile.cmake"

mkdir -p "$(dirname "$source_dir")"

if [[ ! -d "$source_dir/.git" ]]; then
  rm -rf "$source_dir"
  git clone --filter=blob:none --no-checkout "$sdl_repo" "$source_dir"
else
  existing_origin="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
  if [[ "$existing_origin" != "$sdl_repo" ]]; then
    echo "SDL source directory uses a different origin: $existing_origin" >&2
    echo "Expected: $sdl_repo" >&2
    exit 4
  fi
fi

git -C "$source_dir" fetch --depth 1 origin "$sdl_ref"
git -C "$source_dir" checkout --detach --force FETCH_HEAD
git -C "$source_dir" reset --hard FETCH_HEAD
git -C "$source_dir" clean -fdx

major="$(sed -n 's/^set(SDL_MAJOR_VERSION \([0-9][0-9]*\)).*/\1/p' "$source_dir/CMakeLists.txt" | head -n 1)"
minor="$(sed -n 's/^set(SDL_MINOR_VERSION \([0-9][0-9]*\)).*/\1/p' "$source_dir/CMakeLists.txt" | head -n 1)"
micro="$(sed -n 's/^set(SDL_MICRO_VERSION \([0-9][0-9]*\)).*/\1/p' "$source_dir/CMakeLists.txt" | head -n 1)"
detected_version="$major.$minor.$micro"
if [[ "$detected_version" != "$sdl_version" ]]; then
  echo "Unexpected SDL-webOS version at $sdl_ref: $detected_version (expected $sdl_version)" >&2
  exit 5
fi

if ! git -C "$source_dir" apply --check "$patch_file"; then
  echo "SDL lifecycle patch no longer applies cleanly to $sdl_ref." >&2
  exit 6
fi
git -C "$source_dir" apply "$patch_file"

grep -Fq 'kill(getpid(), SIGCONT);' "$source_dir/src/core/webos/SDL_webos_init.c" || {
  echo "SDL lifecycle patch verification failed." >&2
  exit 6
}

rm -rf "$build_dir" "$bundle_dir"
mkdir -p "$build_dir" "$bundle_dir"

echo "Building patched SDL-webOS $sdl_version from $sdl_ref"
docker run --rm --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$sdk_volume:/sdk:ro" \
  -v "$source_dir:/src:ro" \
  -v "$build_dir:/build" \
  -v "$bundle_dir:/out" \
  -e SDL_BUILD_PARALLEL="$parallel" \
  "$docker_image" \
  sh -lc '
    set -eu
    command -v cmake >/dev/null
    command -v ninja >/dev/null
    test -f "'"$toolchain_file"'"

    cmake -S /src -B /build -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE="'"$toolchain_file"'" \
      -DWAYLAND_SCANNER=/usr/bin/wayland-scanner \
      -DGAWK=/usr/bin/gawk \
      -DCMAKE_INSTALL_PREFIX=/out \
      -DCMAKE_BUILD_TYPE=Release \
      -DWEBOS=ON \
      -DSDL_WEBOS_BROKEN_ABI=ON \
      -DSDL_SHARED=OFF \
      -DSDL_STATIC=ON \
      -DSDL_TEST=OFF \
      -DSDL_TESTS=OFF

    ninja -C /build -j "$SDL_BUILD_PARALLEL" install
  '

if [[ ! -f "$bundle_dir/lib/libSDL2.a" ||
      ! -f "$bundle_dir/include/SDL2/SDL.h" ||
      ! -f "$bundle_dir/include/SDL2/SDL_config.h" ]]; then
  echo "SDL build completed without the expected static bundle layout." >&2
  exit 7
fi

if ! grep -Eq '^#define SDL_WEBOS_BROKEN_ABI[[:space:]]+1$' \
  "$bundle_dir/include/SDL2/SDL_config.h"; then
  echo "Built SDL_config.h does not enable SDL_WEBOS_BROKEN_ABI." >&2
  exit 7
fi
if ! grep -Eq '^#define SDL_VIDEO_DRIVER_WAYLAND_WEBOS[[:space:]]+1$' \
  "$bundle_dir/include/SDL2/SDL_config.h"; then
  echo "Built SDL_config.h does not enable the webOS Wayland video backend." >&2
  exit 7
fi

cat > "$stamp_file" <<EOF
version=$sdl_version
source_repository=$sdl_repo
source_ref=$sdl_ref
patch_sha256=$patch_sha256
EOF

echo "Patched SDL-webOS bundle: $bundle_dir"
