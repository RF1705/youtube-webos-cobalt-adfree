# Experimental multi-starter IPK

This branch builds one test IPK containing three LG Cobalt starter generations:

| Profile | Automatic selection | Starter behavior |
| --- | --- | --- |
| `sb13` | webOS SDK 8.x and older, or unknown | Uses the packaged patched Cobalt 23.lts.6 / Starboard 13 runtime with `--evergreen_lite`. |
| `sb14` | webOS SDK 9.x / webOS TV 24 | Uses the OLED48C48LA stock Cobalt 24.lts.60 / Starboard 14 loader with normal Evergreen slot management. |
| `sb16` | webOS SDK 10.x and newer / webOS TV 25+ | Uses the OLED55C36LC stock Cobalt 25.lts.30 / Starboard 16 loader with normal Evergreen slot management. |

This is deliberately a starter compatibility test, not yet a universal AdFree runtime. On webOS 24 and 25 the selected stock loader first tries the Evergreen installation already maintained by stock YouTube on that TV. If no matching slot remains after replacing the stock app, the loader can fall back to the packaged Starboard 13 library and fail its SABI check. That failure is useful diagnostic information for the next step: packaging matching patched API 14 and API 16 runtimes.

## Add the webOS 24 starter

The private images repository already contains the webOS 25 starter. The C4 dump uploaded separately can be used without committing it:

```sh
make images
mkdir -p .private-images/starters/oled48c48la-webos-9.2.2
unzip -p /path/to/OLED48C48.zip cobalt \
  > .private-images/starters/oled48c48la-webos-9.2.2/cobalt
chmod 0755 .private-images/starters/oled48c48la-webos-9.2.2/cobalt
```

A different location can be passed with `MULTISTARTER_SB14_STARTER=/path/to/cobalt`.

## Build

```sh
make -f Makefile.multistarter multistarter-status
make -f Makefile.multistarter multistarter-package
```

The package is written to:

```text
output/youtube.leanback.v4_1.2.190_arm.ipk
```

## Force a profile

Automatic mapping can be overridden at build time:

```sh
make -f Makefile.multistarter multistarter-package MULTISTARTER_DEFAULT=sb14
```

Accepted values are `auto`, `sb13`, `sb14`, and `sb16`.

For an already installed package, create one of these files containing a single profile name:

```text
/tmp/ytaf-cobalt-starter
/media/developer/ytaf-cobalt-starter
```

Example:

```sh
printf '%s\n' sb14 > /tmp/ytaf-cobalt-starter
```

Restart the app after changing the override.

## Diagnostics

The selector records its decision here:

```text
/tmp/ytaf-cobalt-selector.log
```

Relevant Cobalt logs should show whether the selected loader found an Evergreen slot, loaded the system image, or rejected the runtime because of a SABI mismatch.
