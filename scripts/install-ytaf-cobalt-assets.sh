#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cobalt_root="${1:-$repo_root/workdir/cobalt-23.lts.6}"
webapp_output="${WEBAPP_OUTPUT_DIR:-$repo_root/webapp/output}"
base_patch="$repo_root/cobalt-patches/cobalt-23.lts.6.patch"
preload_patch="$repo_root/cobalt-platform/cobalt-23.lts.6-ytaf-preload.patch"
content_target="$cobalt_root/cobalt/adblock/content"
content_build="$content_target/BUILD.gn"
web_module="$cobalt_root/cobalt/browser/web_module.cc"

if [[ ! -d "$cobalt_root/.git" ]]; then
  echo "Not a Cobalt source tree: $cobalt_root" >&2
  exit 2
fi

for asset in adblockMain.js adblockMain.css adblockPreload.js; do
  if [[ ! -s "$webapp_output/$asset" ]]; then
    echo "Missing built web asset: $webapp_output/$asset" >&2
    echo "Build the webapp before compiling starterless Cobalt." >&2
    exit 3
  fi
done

# A fresh starterless checkout still needs the normal YTAF Cobalt integration
# (CSP changes, late adblockMain/CSS injection and adblock content target).
if [[ ! -f "$cobalt_root/cobalt/adblock/BUILD.gn" ]]; then
  git -C "$cobalt_root" apply --check --recount "$base_patch"
  git -C "$cobalt_root" apply --recount "$base_patch"
fi

if [[ ! -f "$content_build" || ! -f "$web_module" ]]; then
  echo "The Cobalt tree does not contain the expected YTAF base integration." >&2
  exit 4
fi

has_preload_asset=0
has_preload_hook=0
grep -q '"adblockPreload.js"' "$content_build" && has_preload_asset=1
grep -q 'ReadYtafPreloadScript' "$web_module" && has_preload_hook=1

if [[ "$has_preload_asset" != "$has_preload_hook" ]]; then
  echo "Partial YTAF preload patch detected in Cobalt source: $cobalt_root" >&2
  echo "Reset the partial preload change before rebuilding." >&2
  exit 5
fi

if [[ "$has_preload_hook" == "0" ]]; then
  git -C "$cobalt_root" apply --check "$preload_patch"
  git -C "$cobalt_root" apply "$preload_patch"
fi

mkdir -p "$content_target"
for asset in adblockMain.js adblockMain.css adblockPreload.js; do
  cp -p "$webapp_output/$asset" "$content_target/$asset"
done

echo "Installed YTAF web assets and early preload integration into: $cobalt_root"
