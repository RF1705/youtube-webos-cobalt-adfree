#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-stock-overlay.sh --tv HOST [--payload DIR] [--app-id ID]

Overlay a prepared Cobalt payload onto an already-installed, LG-signed YouTube
Store application on a rooted TV. The script never stops the app or reboots the
TV; it refuses to continue while the target app is running.

Options:
  --tv HOST       Root SSH destination (required), for example root@living-room-tv
  --payload DIR   Prepared application tree (default: workdir/ipk)
  --app-id ID     Store application id (default: youtube.leanback.v4)
  -h, --help      Show this help
EOF
}

tv_host=
payload=workdir/ipk
app_id=youtube.leanback.v4

while (($#)); do
  case "$1" in
    --tv) tv_host=${2:?missing value for --tv}; shift 2 ;;
    --payload) payload=${2:?missing value for --payload}; shift 2 ;;
    --app-id) app_id=${2:?missing value for --app-id}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$tv_host" ]] || { echo "--tv is required" >&2; exit 2; }
[[ "$app_id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Unsafe application id: $app_id" >&2; exit 2; }
[[ -d "$payload/content/app/cobalt/content" ]] || { echo "Missing runtime content in $payload" >&2; exit 1; }
[[ -f "$payload/content/app/cobalt/lib/libcobalt.so" ]] || { echo "Missing uncompressed libcobalt.so in $payload" >&2; exit 1; }
[[ -f "$payload/switches" ]] || { echo "Missing switches in $payload" >&2; exit 1; }

stage="/tmp/ytaf-stock-overlay.$$"
cleanup() {
  # stage contains only this script's numeric PID and is intentionally expanded locally.
  # shellcheck disable=SC2029
  ssh "$tv_host" "rm -rf '$stage'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# stage contains only this script's numeric PID and is intentionally expanded locally.
# shellcheck disable=SC2029
tar -C "$payload" -cf - \
  switches \
  content/app/cobalt/lib/libcobalt.so \
  content/app/cobalt/content | ssh "$tv_host" "mkdir -p '$stage' && tar -xf - -C '$stage'"

ssh "$tv_host" sh -s -- "$app_id" "$stage" <<'TV_SCRIPT'
set -eu

app_id=$1
stage=$2
app_dir="/media/cryptofs/apps/usr/palm/applications/$app_id"
state_dir=/var/lib/webosbrew/youtube-stock-overlay

test -f "$app_dir/appinfo.json" || {
  echo "The LG Store app is not installed at $app_dir" >&2
  exit 1
}
test -f "$app_dir/content/app/cobalt/lib/libcobalt.so" -o \
     -f "$app_dir/content/app/cobalt/lib/libcobalt.lz4" || {
  echo "The installed app does not contain a native Cobalt runtime" >&2
  exit 1
}

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

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$state_dir/backups/$timestamp"
mkdir -p "$backup"
(
  cd "$app_dir"
  paths=
  for path in switches content/app/cobalt/lib/libcobalt.so \
      content/app/cobalt/lib/libcobalt.lz4 content/app/cobalt/content; do
    test ! -e "$path" || paths="$paths $path"
  done
  # All entries above are fixed paths without whitespace.
  tar -cf "$backup/original.tar" $paths
)
printf '%s\n' "$backup" > "$state_dir/latest-backup"

owner=$(stat -c '%u:%g' "$app_dir/content/app/cobalt/lib" 2>/dev/null || echo 0:0)
cp "$stage/content/app/cobalt/lib/libcobalt.so" \
  "$app_dir/content/app/cobalt/lib/libcobalt.so.new"
chmod 0755 "$app_dir/content/app/cobalt/lib/libcobalt.so.new"
chown "$owner" "$app_dir/content/app/cobalt/lib/libcobalt.so.new"
mv -f "$app_dir/content/app/cobalt/lib/libcobalt.so.new" \
  "$app_dir/content/app/cobalt/lib/libcobalt.so"
rm -f "$app_dir/content/app/cobalt/lib/libcobalt.lz4"

cp "$stage/switches" "$app_dir/switches.new"
chmod 0644 "$app_dir/switches.new"
chown "$owner" "$app_dir/switches.new"
mv -f "$app_dir/switches.new" "$app_dir/switches"

mkdir -p "$app_dir/content/app/cobalt/content"
tar -C "$stage/content/app/cobalt/content" -cf - . | \
  tar -C "$app_dir/content/app/cobalt/content" -xf -
chown -R "$owner" "$app_dir/content/app/cobalt/content"

echo "Overlay installed. Backup: $backup/original.tar"
echo "Launch YouTube normally to load the new runtime; no process was stopped."
TV_SCRIPT
