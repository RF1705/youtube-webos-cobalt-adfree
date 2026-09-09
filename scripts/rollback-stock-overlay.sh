#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/rollback-stock-overlay.sh --tv HOST [--app-id ID]" >&2
}

tv_host=
app_id=youtube.leanback.v4
while (($#)); do
  case "$1" in
    --tv) tv_host=${2:?missing value for --tv}; shift 2 ;;
    --app-id) app_id=${2:?missing value for --app-id}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[[ -n "$tv_host" ]] || { echo "--tv is required" >&2; exit 2; }
[[ "$app_id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Unsafe application id: $app_id" >&2; exit 2; }

ssh "$tv_host" sh -s -- "$app_id" <<'TV_SCRIPT'
set -eu

app_id=$1
app_dir="/media/cryptofs/apps/usr/palm/applications/$app_id"
state_dir=/var/lib/webosbrew/youtube-stock-overlay
test -f "$state_dir/latest-backup" || { echo "No overlay backup found" >&2; exit 1; }
backup=$(cat "$state_dir/latest-backup")
case "$backup" in "$state_dir"/backups/*) ;; *) echo "Invalid backup path" >&2; exit 1 ;; esac
test -f "$backup/original.tar" || { echo "Missing backup archive: $backup/original.tar" >&2; exit 1; }

for proc in /proc/[0-9]*/cmdline; do
  test -r "$proc" || continue
  cmd=$(tr '\000' ' ' < "$proc" 2>/dev/null || true)
  case "$cmd" in
    *"/$app_id/"*|*" $app_id "*|*"appId=$app_id"*)
      echo "YouTube is still running; close it fully and retry. No files were changed." >&2
      exit 1
      ;;
  esac
done

rm -rf "$app_dir/content/app/cobalt/content"
rm -f "$app_dir/content/app/cobalt/lib/libcobalt.so" \
  "$app_dir/content/app/cobalt/lib/libcobalt.lz4" "$app_dir/switches"
tar -xf "$backup/original.tar" -C "$app_dir"
echo "Restored $backup/original.tar. No process was stopped and the TV was not rebooted."
TV_SCRIPT
