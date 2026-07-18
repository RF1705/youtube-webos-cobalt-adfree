# YouTube webOS Cobalt AdFree

[![CI](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/RF1705/youtube-webos-cobalt-adfree?label=latest%20release)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/RF1705/youtube-webos-cobalt-adfree/total?label=downloads)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases)

Unofficial Cobalt-based YouTube app modification for LG webOS TVs with ad blocking and SponsorBlock support.

This project patches the webOS YouTube application by replacing or modifying the Cobalt runtime used by YouTube TV on webOS. The goal is to keep the original YouTube TV experience while adding ad blocking, SponsorBlock support and related improvements.

> This project is unofficial and is not affiliated with YouTube, Google, LG or webOS.

## v1.1.0

The latest release is available from the GitHub releases page:

<https://github.com/RF1705/youtube-webos-cobalt-adfree/releases>

The release uses the original Leanback app id, `youtube.leanback.v4`, to keep
YouTube sign-in and phone pairing compatible. Installing it replaces the
official YouTube application with the patched version.

## Features

* YouTube for LG webOS TVs
* Cobalt-based runtime modification
* Advertisement blocking
* SponsorBlock support
* Return YouTube Dislike support
* Playback speed support
* Optional autostart integration
* Installable as patched `.ipk` package

The configuration screen can be opened with the **GREEN** button on the LG remote.
While a video is playing, press **1** to decrease the playback speed or **3** to
increase it. The available speeds range from 0.25× to 2×.

## Requirements

* LG TV with webOS
* Homebrew Channel, Developer Mode or root access
* Docker
* Git
* Linux or macOS build environment
* Required tools:

```sh
sudo apt install jq git sed binutils squashfs-tools rename findutils xz-utils
```

The patched app uses `youtube.leanback.v4` and therefore replaces the official
YouTube application. Keep a copy of the official package if you want to restore
it later.

## Installation

Download a release `.ipk` package and install it using one of the following methods.

Recommended release package:

```text
youtube.leanback.v4_1.1.0_arm.ipk
```

The release also contains `youtube.leanback.v4.manifest.json` for installation
through the webOS Homebrew Channel.

### Custom Homebrew Channel repository

This project also provides a custom Homebrew Channel repository:

```text
https://rf1705.github.io/youtube-webos-cobalt-adfree/homebrew-repository.json
```

In Homebrew Channel, open **Settings**, choose **Add repository**, and enter
the URL above.

> **Important:** This app uses the same app id (`youtube.leanback.v4`) as the
> YouTube AdFree entry in the default WebOSBrew repository. Do not install both
> variants at the same time: choose one repository entry and uninstall the
> other variant first.

### Install via webOS Device Manager

Use the webOS Device Manager and install the downloaded `.ipk` package.

### Install via ares-cli

```sh
ares-install youtube.leanback.v4_*.ipk
```

### Install via SSH on rooted/Homebrew webOS

Download the release package to `/media/developer/temp` and install it through
the webOS app install service:

```sh
mkdir -p /media/developer/temp
cd /media/developer/temp
wget https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/download/v1.1.0/youtube.leanback.v4_1.1.0_arm.ipk
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/youtube.leanback.v4_1.1.0_arm.ipk","subscribe":true}'
```

After installation, the downloaded package can be removed:

```sh
rm /media/developer/temp/youtube.leanback.v4_1.1.0_arm.ipk
```

## Patch an official YouTube IPK

Clone the repository:

```sh
git clone https://github.com/RF1705/youtube-webos-cobalt-adfree.git
cd youtube-webos-cobalt-adfree
```

Patch your official YouTube IPK:

```sh
make PACKAGE=./your-tv-youtube.ipk
```

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
the matching `23.lts.4-12` runtime:

```sh
make standalone-poc-package
```

This still builds a separate app and does not patch the official YouTube app.
The extracted starter is only a temporary compatibility bridge until a free
webOS Cobalt starter is available.

## Autostart

Autostart can make the app appear as an input source next to HDMI/Live TV.

Enable autostart:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"youtube.leanback.v4","pigImage":"","mvpdIcon":""}'
```

Disable autostart:

```sh
luna-send -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"youtube.leanback.v4"}'
```

Autostart may improve startup time because the app can stay loaded in the background. This can increase idle memory usage.

## Build Cobalt

The repository may include prebuilt Cobalt binaries in `cobalt-bin`.

To build Cobalt yourself, the build process clones Cobalt, applies the patches from `cobalt-patches`, builds `libcobalt.so`, and packages the result.

Example:

```sh
make BUILD_COBALT_DEBUG=0 WEBAPP_DEBUG=0 \
  cobalt-bin/23.lts.4-12/libcobalt.so \
  cobalt-bin/23.lts.4-12.xz
```

For a clean rebuild after changing the Cobalt patch:

```sh
make clean-workdir/cobalt-23.lts.4
rm -rf cobalt-bin/23.lts.4-12 cobalt-bin/23.lts.4-12.xz
make BUILD_COBALT_DEBUG=0 WEBAPP_DEBUG=0 \
  cobalt-bin/23.lts.4-12/libcobalt.so \
  cobalt-bin/23.lts.4-12.xz
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

If this project helps you, you can support the maintainer here:

<https://buymeacoffee.com/rf1705>

## License

See the included license files for details.
