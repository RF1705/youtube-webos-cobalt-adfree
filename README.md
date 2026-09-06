# YouTube webOS Cobalt AdFree

[![CI](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/RF1705/youtube-webos-cobalt-adfree?label=latest%20release)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/RF1705/youtube-webos-cobalt-adfree/total?label=downloads)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases)

Unofficial Cobalt-based YouTube app modification for LG webOS TVs with ad blocking and SponsorBlock support.

This project patches the webOS YouTube application by replacing or modifying the Cobalt runtime used by YouTube TV on webOS. The goal is to keep the original YouTube TV experience while adding ad blocking, SponsorBlock support and related improvements.

> This project is unofficial and is not affiliated with YouTube, Google, LG or webOS.

## v1.2.3

The latest release is available from the GitHub releases page:

<https://github.com/RF1705/youtube-webos-cobalt-adfree/releases>

The standard package uses the original Leanback app id, `youtube.leanback.v4`,
to keep YouTube sign-in and phone pairing compatible. Installing it replaces
the official YouTube application with the patched version.

A separate compatibility package is available for the LG CineBeam HU710PB-GL
and potentially other PJTR/k7lp devices. It uses the stock PJTR app id,
`youtube.leanback.v4-pjtr`, and must only be used on compatible devices.

## Features

* YouTube for LG webOS TVs
* Cobalt-based runtime modification
* Advertisement blocking
* SponsorBlock support
* Return YouTube Dislike support
* Automatic account selection on startup
* Playback speed support
* Optional Shorts visibility across the sidebar, home page and browse sections
* Optional autostart integration
* Installable as patched `.ipk` package

The configuration screen can be opened with the **GREEN** button on the LG remote.
While a video is playing, press **1** to decrease the playback speed or **3** to
increase it. Press **0** to toggle subtitles on or off. The available playback
speeds range from 0.25× to 2×.

When **Enable YouTube Shorts** is disabled, Shorts navigation entries and Shorts
content are hidden from the sidebar, home page, search results and other browse
sections. Direct Shorts playback remains available when opened explicitly.

## Requirements

* LG TV with webOS
* Homebrew Channel, Developer Mode or root access
* Docker
* Git
* Linux or macOS build environment
* Required tools:

```sh
sudo apt install jq git sed binutils squashfs-tools rename findutils xz-utils lz4
```

The standard patched app uses `youtube.leanback.v4` and therefore replaces the
official YouTube application. The PJTR compatibility package uses
`youtube.leanback.v4-pjtr` and replaces the stock PJTR YouTube application.
Keep a copy of the appropriate official package if you want to restore it later.

## Tested Cobalt baseline

The closest currently tested match to a working stock LG installation for the
standard package is:

```text
Cobalt:       23.lts.6
Starboard:    API 13
Architecture: ARMv7 softfp
Starter:      original LG webOS Cobalt starter from the same stock runtime
```

This combination has been tested successfully on the TV from which the stock
runtime was collected. The patched Cobalt library keeps the original ABI and
raises Cobalt's combined persistent cookie/local-storage limit from 4 MiB to
16 MiB. It also logs the serialized storage size and rejects oversized writes
explicitly instead of failing silently.

The separate PJTR/k7lp compatibility package uses:

```text
Cobalt:       23.lts.6
Starboard:    API 12
Architecture: ARMv7 softfp
Starter:      stock LG k7lp/PJTR Cobalt starter
App ID:       youtube.leanback.v4-pjtr
```

### Tested devices

The issue tracker contains the following explicit confirmations. A device is
only listed here when a reporter confirmed that the app starts and is usable;
reports that only confirm installation are not counted. Any reported
limitations are included in the result column.

#### Current compatibility baseline

| Model | webOS | Firmware | Release | Confirmed result |
| --- | --- | --- | --- | --- |
| LG C1 OLED | 6.5.0 | 03.51.16 | v1.2.0 standard package | Clean installation, sign-in, playback, ad blocking and SponsorBlock work. ([#33](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/33#issuecomment-5114026899)) |
| LG CineBeam HU710PB-GL | 6.3.1 | 03.00.27 | v1.2.1 PJTR package | Installation, home screen, sign-in, playback, ad blocking, SponsorBlock and launch after restart work. webOS required selecting **Update** in the Content Store prompt before the first successful launch. ([#1](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/1#issuecomment-5155709661)) |

The standard v1.2.3 package uses the same Cobalt 23.lts.6 / Starboard 13
compatibility baseline as v1.2.0, but has not yet received a separate standard
package device confirmation in the issue tracker. A C1 report for v1.2.0
confirms that 4K was still unavailable on that device
([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-5116177545)).

#### Confirmed on earlier releases

| Model | webOS | Firmware | Release | Confirmed result |
| --- | --- | --- | --- | --- |
| LG TV65QNED (exact suffix not reported) | 6.5.3 | 03.53.45 | v1.0.0 | Playback and ad blocking work; maximum quality is 1080p. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2)) |
| LG 43UP8000PTB | 6.5.3-47 | 03.53.45 | v1.0.0 | Starts and works after installation through Developer Mode; reporter did not provide a feature-by-feature test. ([#7](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/7#issuecomment-4933125977)) |
| LG C1 OLED | 6.5.3-47 | 03.53.45 | v1.0.0 | Playback and SponsorBlock work after the initial black-screen start; limited to 1080p and RYD did not work in this build. ([#3](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/3#issuecomment-4921907497)) |
| LG 65QNED913PA | 6.5.3-47 | 03.53.45 | v1.0.0 | Playback works at up to 1080p; the stock app reaches 2160p on the same TV. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-5010822714)) |
| LG OLED55G19LA | 6.5.3 | 03.53.45 | v1.0.0 | Playback works at up to 1080p. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-4951770514)) |
| LG 7070NANO75SPA | 6.5.3-47 | Not reported | v1.0.0 | Playback works below 4K; sponsored recommendations were still visible. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-4975618738)) |
| LG OLED65A1PVA | 6.5.3 | 03.53.45 | v1.0.0 | Playback works at up to 1080p. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-4991938401)) |
| LG OLED55C1AUB | 6.5.3 | 03.53.45 | v1.1.1 | Playback works, including 4K on a tested AV1 video; a tested VP9 video was limited to 1080p. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-5012585147)) |
| LG OLED55C14LB | 6.5.3 | 03.53.45 | v1.1.0 | Playback works, but the 1/3 playback-speed shortcuts did not work in this release. ([#22](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/22#issuecomment-5063796296)) |
| LG OLED55A16LA | Not reported | 03.53.45 | v1.1.1 / v1.1.2 | Signed-in playback and SponsorBlock work at up to 1080p; signed-out regular videos remain black. ([device report](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/20#issuecomment-5062212503), [working result](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/20#issuecomment-5062835221)) |
| LG OLED55A19LA | 6.2.0-31 | Not reported | v1.1.3 | Sign-in, playback, 4K and HDR work; still working after a TV restart. ([test](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/29#issuecomment-5069526117), [restart](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/29#issuecomment-5069558549)) |
| LG OLED48CXRLA | 5.5.0 | 04.50.90 | v1.1.4, repacked | Starts, plays video and survives reboot after repacking the IPK with non-epoch timestamps. The unmodified release IPK is rejected by this firmware. ([#29](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/29#issuecomment-5080405273)) |
| LG OLED83C17LA | Not reported | 03.53.45 | v1.1.4 | Works normally; v1.1.5 crashes on the same TV. ([#30](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/30#issuecomment-5082975074)) |
| LG OLED65C15LA | 6.5.3 | 03.53.45 | v1.1.0 | Works normally; later tested releases did not start on the same TV. ([#10](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/10#issuecomment-5094616714)) |
| LG OLED48C14LB | 6.5.3-47 | Not reported | v1.1.1 | Playback works, but the progress bar and chapter scrubbing can become incorrect. ([#26](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/26#issuecomment-5120064232)) |
| LG G1 | Not reported | Not reported | v1.1.6 | App and video controls work, but 4K is unavailable. ([#2](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/2#issuecomment-5106892684)) |

These are individual community reports, not guarantees for every regional
variant of the same model. Firmware, installation method, sign-in state and the
exact release can change the result. In particular, the repacked webOS 5.5
entry is not a confirmation of the normal downloadable standard IPK.

Community-reported device, firmware and feature results are collected in the
[device compatibility matrix](docs/device-compatibility.md). The matrix also
contains the reporting template and unpatched baseline test packages used for
compatibility investigations.

Owners of rooted TVs can help investigate older firmware by collecting the
starter from a working stock YouTube installation. See the
[stock starter collection guide](docs/collect-stock-youtube-starter.md).

## Installation

Download the package matching your device from the release page and install it
using one of the following methods.

### Standard package

Use this package for the standard `youtube.leanback.v4` application:

```text
youtube.leanback.v4_1.2.3_arm.ipk
```

The release also contains `youtube.leanback.v4.manifest.json` for installation
of the standard package through the webOS Homebrew Channel.

### PJTR/k7lp compatibility package

Use this package only for the LG CineBeam HU710PB-GL or another confirmed
PJTR/k7lp device using the stock app id `youtube.leanback.v4-pjtr`:

```text
youtube.leanback.v4-pjtr_1.2.3_arm.ipk
```

SHA-256:

```text
b2bb04232130b8e95a75bcf989140992d709ae9b0ae6ab952df7b16d76e6c744
```

Because this package uses the same app id as the stock PJTR YouTube
application, webOS may display an **Update or Launch** prompt after installation.
On the tested HU710PB-GL, selecting **Update** and completing the Content Store
update was required before the application could be launched. The patched app
continued to work normally afterwards.

The PJTR package is an unofficial community compatibility build containing a
stock LG Cobalt starter. The original starter archive and standalone proprietary
binaries are not distributed separately.

### Custom Homebrew Channel repository

This project also provides a custom Homebrew Channel repository for the
standard package:

```text
https://raw.githubusercontent.com/RF1705/youtube-webos-cobalt-adfree/main/repo.json
```

In Homebrew Channel, open **Settings**, choose **Add repository**, and enter
the URL above.

> **Important:** The standard package uses the same app id
> (`youtube.leanback.v4`) as the YouTube AdFree entry in the default WebOSBrew
> repository. Do not install both variants at the same time: choose one
> repository entry and uninstall the other variant first.

The PJTR/k7lp package is currently available as a manual release download and
is not included in the custom Homebrew Channel repository.

### Install via webOS Device Manager

Use the webOS Device Manager and install the downloaded `.ipk` package.

### Install via ares-cli

Standard package:

```sh
ares-install youtube.leanback.v4_1.2.3_arm.ipk
```

PJTR/k7lp package:

```sh
ares-install youtube.leanback.v4-pjtr_1.2.3_arm.ipk
```

### Install via SSH on rooted/Homebrew webOS

Download the appropriate release package to `/media/developer/temp` and install
it through the webOS app install service.

Standard package:

```sh
mkdir -p /media/developer/temp
cd /media/developer/temp
wget https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/download/v1.2.3/youtube.leanback.v4_1.2.3_arm.ipk
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/youtube.leanback.v4_1.2.3_arm.ipk","subscribe":true}'
```

PJTR/k7lp package:

```sh
mkdir -p /media/developer/temp
cd /media/developer/temp
wget https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/download/v1.2.3/youtube.leanback.v4-pjtr_1.2.3_arm.ipk
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/youtube.leanback.v4-pjtr_1.2.3_arm.ipk","subscribe":true}'
```

After installation, the downloaded package can be removed:

```sh
rm /media/developer/temp/youtube.leanback.v4*_1.2.3_arm.ipk
```

## Patch an official YouTube IPK

Clone the repository:

```sh
git clone https://github.com/RF1705/youtube-webos-cobalt-adfree.git
cd youtube-webos-cobalt-adfree
```

Maintainer build images are stored separately in the private
`RF1705/YouTube-webos-images` repository. Authorized maintainers can clone or
update them with:

```sh
make images
```

The files are checked out into the ignored `.private-images` directory and
verified against that repository's `SHA256SUMS`. Locally built Cobalt archives
in `cobalt-bin/` take precedence over the private copy.

Patch your official YouTube IPK:

```sh
make package PACKAGE=./your-tv-youtube.ipk
```

For source packages with `libcobalt.lz4`, the build replaces that file and adds
the content-size metadata required by newer LG loaders. The replacement Cobalt
runtime must match the starter's Starboard API.

For maintainers, a plain `make` builds the current standard package from the
private `youtube-official-1.1.5.tar.gz` base and the tested
`23.lts.6`/Starboard 13 runtime:

```sh
make
```

Do not commit or publish the stock application backup. It can contain
LG/YouTube-protected files such as `drm.nfz`; the packaging process removes
that file from the patched IPK.

### k7lp/PJTR package

The HU710PB-GL stock starter uses the application id
`youtube.leanback.v4-pjtr`, ARMv7 softfp and Starboard API 12. Build its
separate package with:

```sh
make pjtr-package
```

The target updates the private images, verifies the exact starter contents and
uses `.private-images/cobalt-bin/23.lts.6-12.xz` to create:

```text
output/youtube.leanback.v4-pjtr_1.2.3_arm.ipk
```

Override `PROJECT_VERSION` when preparing another release. The starter archive
is private input and must remain outside Git. The build checks the exact file
list, app id, k7lp metadata and known SHA-256 hashes of `cobalt` and
`appinfo.json` before packaging.

Only the finished compatibility IPK is published. Do not publish the original
starter archive, a standalone stock `cobalt` binary or device dump files.

By default the patched package uses:

```text
App ID: youtube.leanback.v4
Name:   YouTube webOS Cobalt AdFree
```

The patched IPK will be created in the `output/` directory.

## Standalone Cobalt launcher

The standalone launcher path builds an app that only starts Cobalt with the
YouTube TV URL. It does not copy files from an official YouTube package.

```sh
make standalone-package
```

Default values:

```text
App ID: com.cobalt.youtube.launcher
Name:   YouTube Cobalt
URL:    https://www.youtube.com/tv?launch=menu
Cobalt: Evergreen 7.1.2, arm-softfp, sbversion-18
```

This target needs a free Cobalt runtime directory containing:

```text
cobalt-bin/7.1.2-arm-softfp-sb18/cobalt
cobalt-bin/7.1.2-arm-softfp-sb18/lib/libcobalt.lz4
cobalt-bin/7.1.2-arm-softfp-sb18/content/
```

`libcobalt.lz4` and `content/` can come from the official Cobalt Evergreen
release asset:

```text
cobalt_evergreen_7.1.2_arm-softfp_sbversion-18_release_compressed_20260627021609.crx
```

The release asset does not include the webOS app starter. Provide a
webOS-compatible Cobalt starter from the matching `27.lts.1` source/port and
copy it into the runtime directory as `cobalt`. Cobalt's Evergreen
`loader_app` target may produce a shared object on Evergreen platforms; that is
not by itself the executable webOS `main` file.

The older patch archives usually only contain `libcobalt.so`, because they
reuse the official YouTube app's Cobalt starter. In that case the standalone
target stops with a clear error instead of falling back to official app files.

The app id, title and URL can be changed:

```sh
make standalone-package \
  STANDALONE_APP_ID=com.cobalt.youtube.launcher \
  STANDALONE_DISPLAY_NAME="YouTube Cobalt" \
  STANDALONE_YOUTUBE_URL="https://www.youtube.com/tv?launch=menu"
```

For a compatibility proof of concept that uses the extracted webOS starter with
the matching `23.lts.6-12` runtime:

```sh
make standalone-poc-package
```

This still builds a separate app and does not patch the official YouTube app.
The extracted starter is only a temporary compatibility bridge until a free
webOS Cobalt starter is available.

## Autostart

Autostart can make the app appear as an input source next to HDMI/Live TV.

Enable autostart for the standard package:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

Disable autostart for the standard package:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

For the PJTR package, replace `youtube.leanback.v4` with
`youtube.leanback.v4-pjtr` in these commands.

Autostart may improve startup time because the app can stay loaded in the background. This can increase idle memory usage.

## Build Cobalt

The repository may include prebuilt Cobalt binaries in `cobalt-bin`.

To build Cobalt yourself, the build process clones Cobalt, applies the patches from `cobalt-patches`, builds `libcobalt.so`, and packages the result.

Example:

```sh
make BUILD_COBALT_PARALLEL=4 BUILD_COBALT_DEBUG=0 WEBAPP_DEBUG=0 \
  cobalt-bin/23.lts.6-12/libcobalt.so \
  cobalt-bin/23.lts.6-12.xz
```

For the standard SB13 runtime:

```sh
make BUILD_COBALT_PARALLEL=4 BUILD_COBALT_DEBUG=0 WEBAPP_DEBUG=0 \
  cobalt-bin/23.lts.6-13/libcobalt.so \
  cobalt-bin/23.lts.6-13.xz
```

For a clean rebuild after changing the Cobalt patch:

```sh
make clean-workdir/cobalt-23.lts.6
rm -rf cobalt-bin/23.lts.6-13 cobalt-bin/23.lts.6-13.xz
make BUILD_COBALT_PARALLEL=4 BUILD_COBALT_DEBUG=0 WEBAPP_DEBUG=0 \
  cobalt-bin/23.lts.6-13/libcobalt.so \
  cobalt-bin/23.lts.6-13.xz
```

## Development TV setup

### Developer Mode App

Install the Developer Mode app on the TV, enable Developer Mode and enable the keyserver. Then download the private key:

```text
http://TV_IP:9991/webos_rsa
```

Configure the TV:

```sh
ares-setup-device -a webos \
  -i "username=prisoner" \
  -i "privatekey=/path/to/webos_rsa" \
  -i "passphrase=PASSPHRASE" \
  -i "host=TV_IP" \
  -i "port=9922"
```

### Homebrew Channel / root access

Enable SSH in the Homebrew Channel app, copy your public SSH key to the TV, then configure the device:

```sh
ares-setup-device -a webos \
  -i "username=root" \
  -i "privatekey=/path/to/id_rsa" \
  -i "passphrase=SSH_KEY_PASSPHRASE" \
  -i "host=TV_IP" \
  -i "port=22"
```

## Project status

This project is community maintained. YouTube TV, Cobalt and webOS can change at any time. Ad blocking, SponsorBlock, login behavior or playback features may break after updates from YouTube or LG.

## Credits

This project builds on research and work from the webOS Homebrew, Cobalt and YouTube TV modification communities.

Special thanks to these projects and maintainers whose work made this project possible:

* [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos)
* [webosbrew/youtube-webos](https://github.com/webosbrew/youtube-webos)
* [UltraHDR/youtube-webos-cobalt](https://github.com/UltraHDR/youtube-webos-cobalt)

Thanks to the contributors in [issue #1](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/1)
for providing the PJTR starter, device information and compatibility testing.

If this project helps you, you can support the maintainer here:

<https://buymeacoffee.com/rf1705>

## License

See the included license files for details.
