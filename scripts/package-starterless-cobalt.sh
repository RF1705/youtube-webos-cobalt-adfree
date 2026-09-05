#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${COBALT_BUILD_DIR:-$repo_root/workdir/cobalt-23.lts.6/out/webos-arm-sbversion-13_devel}"
output_dir="${COBALT_PACKAGE_OUTPUT_DIR:-$repo_root/output}"
runtime_dir="${COBALT_RUNTIME_DIR:-$repo_root/starterless-cobalt/lib}"
webapp_output="${WEBAPP_OUTPUT_DIR:-$repo_root/webapp/output}"
package_id="$(jq -r '.id' "$repo_root/starterless-cobalt/appinfo.json")"
package_version="$(jq -r '.version' "$repo_root/starterless-cobalt/appinfo.json")"
ares_package="$(command -v ares-package || true)"

if [[ -z "$ares_package" && -x "$repo_root/node_modules/.bin/ares-package" ]]; then
  ares_package="$repo_root/node_modules/.bin/ares-package"
fi
if [[ -z "$ares_package" ]]; then
  echo "ares-package was not found. Install @webos-tools/cli first." >&2
  exit 2
fi
if [[ ! -x "$build_dir/cobalt" || ! -d "$build_dir/content" ]]; then
  echo "Missing completed starterless Cobalt build in: $build_dir" >&2
  exit 3
fi
if [[ ! -f "$runtime_dir/libstdc++.so.6" || ! -f "$runtime_dir/libgcc_s.so.1" ]]; then
  echo "Missing ARM C++ runtime libraries in: $runtime_dir" >&2
  exit 4
fi

# Never package a starterless binary from before the early-preload integration.
# Gold builds compile non-fatal LOG() strings out, so verify the runtime path
# that ReadYtafPreloadScript() must retain in the binary instead.
if ! grep -aFq '/web/adblock/adblockPreload.js' "$build_dir/cobalt"; then
  echo "Starterless Cobalt binary is stale and does not contain the YTAF early preload hook." >&2
  echo "Run scripts/build-starterless-cobalt-docker.sh first." >&2
  exit 5
fi

for asset in adblockMain.js adblockMain.css adblockPreload.js; do
  if [[ ! -s "$webapp_output/$asset" ]]; then
    echo "Missing current web asset: $webapp_output/$asset" >&2
    echo "Run make docker-make.npm before packaging." >&2
    exit 6
  fi
done
if ! grep -Fq '__shorts' "$webapp_output/adblockMain.js"; then
  echo "Current adblockMain.js does not contain the Shorts UI." >&2
  exit 7
fi
if ! grep -Fq '__ytafPreloadExecuted' "$webapp_output/adblockPreload.js"; then
  echo "Current adblockPreload.js does not contain the early Shorts hook." >&2
  exit 8
fi

package_root="$(mktemp -d "${TMPDIR:-/tmp}/cobalt-starterless-package.XXXXXX")"
trap 'rm -rf "$package_root"' EXIT

cp "$repo_root/starterless-cobalt/appinfo.json" "$package_root/appinfo.json"
cp "$build_dir/cobalt" "$package_root/cobalt"
cp -R "$build_dir/content" "$package_root/content"

# Always overlay the selected web assets at packaging time. For artifact-based
# packaging WEBAPP_OUTPUT_DIR may point at the runtime artifact itself, which
# keeps the IPK byte-for-byte aligned with the tested Cobalt content bundle.
adblock_target="$package_root/content/web/adblock"
mkdir -p "$adblock_target"
rm -rf "$adblock_target"/*
cp -p "$webapp_output/adblockMain.js" "$adblock_target/adblockMain.js"
cp -p "$webapp_output/adblockMain.css" "$adblock_target/adblockMain.css"
cp -p "$webapp_output/adblockPreload.js" "$adblock_target/adblockPreload.js"

# Development-only resources are not needed by the TV application. Leaving
# them out saves roughly 8 MB installed without removing runtime fonts or ICU.
rm -rf "$package_root/content/web/debug_remote" "$package_root/content/test"
# Incremental GN builds do not delete fonts from an earlier package profile.
# Keep only files referenced by the newly generated filtered fonts.xml so a
# previous standard-font build cannot silently add ~20 MB back to the IPK.
fonts_xml="$package_root/content/fonts/fonts.xml"
if [[ -f "$fonts_xml" ]]; then
  while IFS= read -r -d '' font_path; do
    font_name="$(basename "$font_path")"
    if ! grep -Fq ">$font_name<" "$fonts_xml"; then
      rm -f "$font_path"
    fi
  done < <(find "$package_root/content/fonts" -type f ! -name fonts.xml -print0)
fi
mkdir -p "$package_root/lib"
cp "$runtime_dir/libstdc++.so.6" "$package_root/lib/libstdc++.so.6"
cp "$runtime_dir/libgcc_s.so.1" "$package_root/lib/libgcc_s.so.1"
cp "$repo_root/assets/icon.png" "$package_root/icon.png"
cp "$repo_root/assets/largeIcon.png" "$package_root/largeIcon.png"
chmod +x "$package_root/cobalt"

# Final guard on the exact package tree, not only the source/output directories.
test -s "$adblock_target/adblockPreload.js"
grep -Fq '__shorts' "$adblock_target/adblockMain.js"
grep -Fq '__ytafPreloadExecuted' "$adblock_target/adblockPreload.js"

mkdir -p "$output_dir"
"$ares_package" --no-minify --outdir "$output_dir" "$package_root"

package_path="$(find "$output_dir" -maxdepth 1 -type f -name "${package_id}_${package_version}_*.ipk" -print -quit)"
if [[ -z "$package_path" ]]; then
  echo "ares-package succeeded but its output IPK was not found." >&2
  exit 9
fi
python3 "$repo_root/scripts/normalize-ipk-ownership.py" "$package_path"
python3 "$repo_root/scripts/verify-ipk-container.py" "$package_path"
echo "Youtube Cobalt AdFree package: $package_path"
