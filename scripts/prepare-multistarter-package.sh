#!/bin/sh

set -eu

if [ "$#" -ne 4 ]; then
    echo "Usage: $0 APP_DIR SB14_STARTER SB16_STARTER DEFAULT_PROFILE" >&2
    exit 64
fi

app_dir=$1
sb14_starter=$2
sb16_starter=$3
default_profile=$4
selector_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/cobalt-selector.sh

case "$default_profile" in
    auto|sb13|sb14|sb16) ;;
    *)
        echo "Invalid DEFAULT_PROFILE: $default_profile" >&2
        exit 64
        ;;
esac

for required in \
    "$app_dir/cobalt" \
    "$app_dir/appinfo.json" \
    "$selector_source" \
    "$sb14_starter" \
    "$sb16_starter"
do
    if [ ! -f "$required" ]; then
        echo "Missing required file: $required" >&2
        exit 1
    fi
done

mkdir -p "$app_dir/starters"

mv "$app_dir/cobalt" "$app_dir/starters/cobalt-sb13"
cp "$sb14_starter" "$app_dir/starters/cobalt-sb14"
cp "$sb16_starter" "$app_dir/starters/cobalt-sb16"
chmod 0755 "$app_dir/starters/cobalt-sb13" \
           "$app_dir/starters/cobalt-sb14" \
           "$app_dir/starters/cobalt-sb16"

cp "$selector_source" "$app_dir/cobalt"
chmod 0755 "$app_dir/cobalt"

if [ -f "$app_dir/switches" ]; then
    sed '/--evergreen_lite/d' "$app_dir/switches" > "$app_dir/switches.multistarter"
    mv "$app_dir/switches.multistarter" "$app_dir/switches"
fi

printf '%s\n' "$default_profile" > "$app_dir/starter-override"

hash_file() {
    file=$1
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        printf '%s\n' unavailable
    fi
}

cat > "$app_dir/multistarter.json" <<EOF_JSON
{
  "default": "$default_profile",
  "profiles": {
    "sb13": {
      "webos": "8.x and older/unknown",
      "mode": "evergreen_lite",
      "sha256": "$(hash_file "$app_dir/starters/cobalt-sb13")"
    },
    "sb14": {
      "webos": "9.x (webOS TV 24)",
      "mode": "evergreen_slots",
      "sha256": "$(hash_file "$app_dir/starters/cobalt-sb14")"
    },
    "sb16": {
      "webos": "10.x and newer (webOS TV 25+)",
      "mode": "evergreen_slots",
      "sha256": "$(hash_file "$app_dir/starters/cobalt-sb16")"
    }
  }
}
EOF_JSON

echo "Prepared multi-starter application in $app_dir"
