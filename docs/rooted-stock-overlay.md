# Rooted signed-Store overlay

Recent webOS releases can reject or fail to register a developer-packaged
native Cobalt application even when `ares-install` accepts the IPK. On a rooted
TV, the reliable alternative is to let LG install and register the signed
YouTube Store application, then overlay only the compatible Cobalt library,
switches, and runtime content.

This is a rooted-TV workflow. It does not bypass Store authentication and does
not redistribute LG or Google binaries.

## Validated combination

The method was validated on an LG C3 running firmware 04.08.18 and webOS
11.2.0. The installed Store package reported version 1.2.21 (application
26.1.1) and used Cobalt 25 LTS with Starboard API 16. The tested patched
`libcobalt.so` SHA-256 was:

```text
8b51073dcab9a23fd699d32d04da81ad79b636c67b7fb5d284aa2bb30ec34b5f
```

Native Cobalt launch, video playback, the Extended menu, ad blocking, and
SponsorBlock were confirmed. Playback-speed controls were not revalidated.
Treat a Cobalt or Starboard mismatch as incompatible even if the TV model is
the same.

## Prepare the payload

Install YouTube from the LG Content Store first. Verify that the signed stock
application launches normally, then close it fully.

Build or unpack a patched payload so that `workdir/ipk` contains at least:

```text
switches
content/app/cobalt/lib/libcobalt.so
content/app/cobalt/content/
```

For the validated baseline, build Cobalt `25.lts.stable` for Starboard API 16
and package it against the matching official YouTube package:

```sh
make cobalt-bin/25.lts.stable-16/libcobalt.so
make cobalt-bin/25.lts.stable-16.xz

make package \
  PACKAGE=/private/path/youtube.leanback.v4.ipk \
  PACKAGE_COBALT_VERSION=25.lts.stable \
  PACKAGE_SB_API_VERSION=16 \
  PACKAGE_COBALT_ARCHIVE=cobalt-bin/25.lts.stable-16.xz
```

Do not substitute a runtime built for another Starboard API. The official IPK
and runtime archive must remain outside version control.

## Install the overlay

With the Store app fully closed, run:

```sh
make install-stock-overlay TV_HOST=root@tv
```

Use `STOCK_OVERLAY_PAYLOAD=/path/to/prepared/tree` if the payload is not in
`workdir/ipk`. The installer:

1. refuses to proceed if the target app is running;
2. archives the files it will replace under
   `/var/lib/webosbrew/youtube-stock-overlay/backups/`;
3. atomically replaces `libcobalt.so` and `switches`;
4. removes the stock `libcobalt.lz4`, so the uncompressed patched library is
   loaded;
5. overlays the matching runtime content while leaving `appinfo.json`, the app
   id, and LG's Store registration untouched.

The script never kills a process and never reboots the TV. Launch YouTube
normally after it completes. A Store update can replace the overlaid files; if
the new app still has the same Cobalt and Starboard ABI, rebuild against that
package and apply the overlay again.

## Verify

Check the live library hash before launching:

```sh
ssh root@tv sha256sum \
  /media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/content/app/cobalt/lib/libcobalt.so
```

Then confirm launch, ordinary playback, the Green-button Extended menu, ad
blocking, SponsorBlock, and any playback-speed behavior you rely on.

## Roll back

Close YouTube fully, then restore the backup created by the latest overlay:

```sh
make rollback-stock-overlay TV_HOST=root@tv
```

Rollback also refuses to act while YouTube is running and does not reboot the
TV. Reinstalling or updating YouTube through the LG Content Store is the
vendor-supported recovery path if the local backup is unavailable.

## Why the signed app stays in place

The working result depends on two separate pieces: LG's signed Store package
provides a native app identity that webOS 11 registers and launches, while the
ABI-matched patched Cobalt library and assets provide the project features.
Repacking those same files into a developer IPK changes the installation and
registration path, which is the part that failed on the tested webOS 11.2 TV.
