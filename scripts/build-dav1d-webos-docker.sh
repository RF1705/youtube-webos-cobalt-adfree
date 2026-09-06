#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cobalt_root="${COBALT_SOURCE_DIR:-$repo_root/workdir/cobalt-23.lts.6}"
sdk_volume="${WEBOS_LINUX_SDK_VOLUME:-ytaf-webos-linux-sdk}"
codec_image="${WEBOS_CODEC_BUILD_IMAGE:-cobalt-build-webos-codecs:latest}"
"$repo_root/scripts/ensure-webos-codec-image.sh"
parallel="${DAV1D_PARALLEL:-4}"
tools_dir="$cobalt_root/out/python-tools"
version="0.5.2"
archive="$cobalt_root/out/downloads/dav1d-$version.tar.gz"
source_dir="$cobalt_root/out/dav1d-$version-source"
build_dir="$cobalt_root/out/dav1d-webos-official"
meson="$tools_dir/bin/meson"

if ! docker volume inspect "$sdk_volume" >/dev/null 2>&1; then
  echo "Missing Docker SDK volume: $sdk_volume" >&2
  exit 3
fi

if [[ ! -f "$source_dir/meson.build" ]]; then
  mkdir -p "$(dirname "$archive")" "$source_dir"
  if [[ ! -f "$archive" ]]; then
    curl --fail --location --retry 3 \
      "https://code.videolan.org/videolan/dav1d/-/archive/$version/dav1d-$version.tar.gz" \
      --output "$archive"
  fi
  echo "34180d4c48f65785242c3062b2e098d4c9388b384a8480a5466eb4e452dc4af9  $archive" \
    | shasum -a 256 --check
  tar -xzf "$archive" --strip-components=1 -C "$source_dir"
fi

if [[ ! -x "$meson" ]]; then
  mkdir -p "$tools_dir"
  docker run --rm --platform linux/amd64 \
    -v "$cobalt_root:/code" \
    "$codec_image" \
    python3 -m pip install --disable-pip-version-check \
      --no-warn-script-location --target /code/out/python-tools meson==0.63.3
fi

# Create the build directory on the host so it remains writable by the invoking
# user after Meson/Ninja populate it from the root-running Docker container.
mkdir -p "$build_dir"

if [[ ! -f "$build_dir/build.ninja" ]]; then
  docker run --rm --platform linux/amd64 \
    -v "$repo_root:/workspace:ro" \
    -v "$cobalt_root:/code" \
    -v "$sdk_volume:/sdk" \
    -e PYTHONPATH=/code/out/python-tools \
    "$codec_image" \
    python3 /code/out/python-tools/bin/meson setup \
      /code/out/dav1d-webos-official /code/out/dav1d-$version-source \
      --cross-file /workspace/cobalt-platform/webos-arm-dav1d-cross.ini \
      --default-library=static \
      --buildtype=minsize \
      -Denable_tools=false \
      -Denable_examples=false \
      -Denable_tests=false \
      -Dlogging=false
fi

docker run --rm --platform linux/amd64 \
  -v "$repo_root:/workspace:ro" \
  -v "$cobalt_root:/code" \
  -v "$sdk_volume:/sdk" \
  -w /code/out/dav1d-webos-official \
  -e PYTHONPATH=/code/out/python-tools \
  "$codec_image" \
  ninja -j "$parallel" src/libdav1d.a

test -s "$build_dir/src/libdav1d.a"
mkdir -p "$build_dir/public/dav1d"
cp "$source_dir/include/dav1d/"*.h "$build_dir/public/dav1d/"
cp "$build_dir/include/dav1d/version.h" "$build_dir/public/dav1d/version.h"
echo "ARM dav1d archive: $build_dir/src/libdav1d.a"
