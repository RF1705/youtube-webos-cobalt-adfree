# YouTube webOS Cobalt AdFree

[![CI](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/RF1705/youtube-webos-cobalt-adfree?label=latest%20release)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/RF1705/youtube-webos-cobalt-adfree/total?label=downloads)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases)

Unofficial Cobalt-based YouTube app modification for LG webOS TVs with ad blocking and SponsorBlock support.

This project patches the webOS YouTube application by replacing or modifying the Cobalt runtime used by YouTube TV on webOS. The goal is to keep the original YouTube TV experience while adding ad blocking, SponsorBlock support and related improvements.

> This project is unofficial and is not affiliated with YouTube, Google, LG or webOS.

## v1.0.0

The first public release is available from the GitHub releases page:

<https://github.com/RF1705/youtube-webos-cobalt-adfree/releases>

The release package uses its own app id, `com.cobalt.youtube.adfree`, so it can be installed next to the official YouTube app without overwriting it.

## Features

* YouTube for LG webOS TVs
* Cobalt-based runtime modification
* Advertisement blocking
* SponsorBlock support
* Playback speed support
* Optional autostart integration
* Installable as patched `.ipk` package

The configuration screen can be opened with the **GREEN** button on the LG remote.

## Requirements

* LG TV with webOS
* Homebrew Channel, Developer Mode or root access
* Docker
* Git
* Linux or macOS build environment
* Required tools:

```sh
sudo apt install jq git patch sed binutils squashfs-tools rename findutils xz-utils
```

The patched app uses its own app id by default: `com.cobalt.youtube.adfree`.
It can be installed next to the official YouTube app.

## Installation

Download a release `.ipk` package and install it using one of the following methods.

Recommended release package:

```text
com.cobalt.youtube.adfree_1.0.0_arm.ipk
```

### Install via webOS Device Manager

Use the webOS Device Manager and install the downloaded `.ipk` package.

### Install via ares-cli

```sh
ares-install com.cobalt.youtube.adfree_*.ipk
```

### Install via SSH on rooted/Homebrew webOS

Download the release package to `/media/developer/temp` and install it through
the webOS app install service:

```sh
mkdir -p /media/developer/temp
cd /media/developer/temp
wget https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/download/v1.0.0/com.cobalt.youtube.adfree_1.0.0_arm.ipk
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/com.cobalt.youtube.adfree_1.0.0_arm.ipk","subscribe":true}'
```

After installation, the downloaded package can be removed:

```sh
rm /media/developer/temp/com.cobalt.youtube.adfree_1.0.0_arm.ipk
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
App ID: com.cobalt.youtube.adfree
Name:   YouTube Cobalt AdFree
```

To overwrite the official YouTube app instead:

```sh
make PACKAGE=./your-tv-youtube.ipk PACKAGE_NAME=youtube.leanback.v4
```

The patched IPK will be created next to the original package.

## Autostart

Autostart can make the app appear as an input source next to HDMI/Live TV.

Enable autostart:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"com.cobalt.youtube.adfree","pigImage":"","mvpdIcon":""}'
```

Disable autostart:

```sh
luna-send -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"com.cobalt.youtube.adfree"}'
```

Autostart may improve startup time because the app can stay loaded in the background. This can increase idle memory usage.

## Build Cobalt

The repository may include prebuilt Cobalt binaries in `cobalt-bin`.

To build Cobalt yourself, the build process clones Cobalt, applies the patches from `cobalt-patches`, builds `libcobalt.so`, and packages the result.

Example:

```sh
make cobalt-bin/23.lts.4-12/libcobalt.so cobalt-bin/23.lts.4-12.xz
```

If the build fails after updating the repository, try cleaning old Docker images and Cobalt output:

```sh
docker image rm cobalt-build-evergreen cobalt-build-linux cobalt-build-base cobalt-base
rm -fr cobalt/out/
make cobalt-clean
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

If this project helps you, you can support the maintainer here:

<https://buymeacoffee.com/rf1705>

## License

See the included license files for details.
