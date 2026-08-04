#!/bin/sh

# Runtime selector for the experimental multi-starter YouTube package.
# The launcher deliberately keeps Starboard 13 in Evergreen Lite mode, while
# newer starters use LG's normal Evergreen slot management. This first test
# therefore answers one question only: does the device-specific starter launch?

set -u

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)
LOG_FILE=${YTAF_SELECTOR_LOG:-/tmp/ytaf-cobalt-selector.log}

log() {
    message="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true) $*"
    printf '%s\n' "$message" >> "$LOG_FILE" 2>/dev/null || true
    printf '%s\n' "$message" >&2
}

read_override() {
    if [ -n "${YTAF_COBALT_STARTER:-}" ]; then
        printf '%s\n' "$YTAF_COBALT_STARTER"
        return
    fi

    for override_file in \
        /tmp/ytaf-cobalt-starter \
        /media/developer/ytaf-cobalt-starter \
        "$APP_DIR/starter-override"
    do
        if [ -r "$override_file" ]; then
            sed -n '1{s/[[:space:]]//g;p;}' "$override_file"
            return
        fi
    done

    printf '%s\n' auto
}

extract_version() {
    for release_file in /etc/webos-release /etc/os-release; do
        [ -r "$release_file" ] || continue

        value=$(sed -n \
            -e 's/^WEBOS_VERSION[[:space:]]*=[[:space:]]*//p' \
            -e 's/^webos_release[[:space:]]*=[[:space:]]*//p' \
            -e 's/^SDK_VERSION[[:space:]]*=[[:space:]]*//p' \
            -e 's/^VERSION_ID[[:space:]]*=[[:space:]]*//p' \
            "$release_file" | head -n 1 | tr -d '\"' | tr -d "'")

        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return
        fi
    done

    if command -v luna-send >/dev/null 2>&1; then
        response=$(luna-send -n 1 -f \
            luna://com.webos.service.tv.systemproperty/getSystemInfo \
            '{"keys":["sdkVersion"]}' 2>/dev/null || true)
        value=$(printf '%s\n' "$response" | sed -n 's/.*"sdkVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return
        fi
    fi

    printf '%s\n' unknown
}

select_profile() {
    override=$(read_override)
    case "$override" in
        sb13|sb14|sb16)
            printf '%s\n' "$override"
            return
            ;;
        auto|'')
            ;;
        *)
            log "Ignoring invalid starter override: $override"
            ;;
    esac

    version=$(extract_version)
    major=$(printf '%s\n' "$version" | sed -n 's/^[^0-9]*\([0-9][0-9]*\).*/\1/p')

    case "$major" in
        ''|*[!0-9]*)
            log "Could not detect webOS SDK version (value: $version); falling back to sb13"
            printf '%s\n' sb13
            ;;
        *)
            if [ "$major" -ge 10 ]; then
                printf '%s\n' sb16
            elif [ "$major" -ge 9 ]; then
                printf '%s\n' sb14
            else
                printf '%s\n' sb13
            fi
            ;;
    esac
}

profile=$(select_profile)
starter="$APP_DIR/starters/cobalt-$profile"

if [ ! -x "$starter" ]; then
    log "Selected starter is missing or not executable: $starter"
    fallback="$APP_DIR/starters/cobalt-sb13"
    if [ ! -x "$fallback" ]; then
        log "Fallback starter is also unavailable: $fallback"
        exit 127
    fi
    profile=sb13
    starter=$fallback
fi

version=$(extract_version)
log "webOS SDK=$version profile=$profile starter=$starter"

case "$profile" in
    sb13)
        # The packaged patched Cobalt 23.lts.6 / Starboard 13 runtime is used.
        exec "$starter" --evergreen_lite "$@"
        ;;
    sb14|sb16)
        # Do not force Evergreen Lite here. The device-specific stock loader can
        # first try the Evergreen installation already maintained by stock
        # YouTube on the TV. If no matching slot exists, its own logs should
        # reveal the fallback/SABI failure.
        exec "$starter" "$@"
        ;;
    *)
        log "Internal error: unsupported profile $profile"
        exit 64
        ;;
esac
