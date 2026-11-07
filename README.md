# YouTube webOS Cobalt AdFree

[![CI](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RF1705/youtube-webos-cobalt-adfree/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/RF1705/youtube-webos-cobalt-adfree?label=latest%20release)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/RF1705/youtube-webos-cobalt-adfree/total?label=downloads)](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases)

Unofficial Cobalt-based YouTube modification for LG webOS TVs with ad blocking and SponsorBlock support.

The **v2.0.0 stable release** introduces the starterless Cobalt 2.x architecture. Read the [v2.0.0 release notes](docs/release-v2.0.0.md) for details.

> This project is unofficial and is not affiliated with YouTube, Google, LG or webOS.

![YouTube webOS Cobalt AdFree settings](docs/images/settings.webp)

![YouTube playback with SponsorBlock segments and dislike counts](docs/images/playback.webp)

## Features

- YouTube for LG webOS TVs
- Advertisement blocking
- SponsorBlock support
- Return YouTube Dislike support
- Automatic account selection on startup
- Playback speed support
- Optional Shorts visibility
- Optional autostart integration
- Native starterless Cobalt runtime without the legacy LG Cobalt starter binary
- LG Magic Remote scroll wheel integration
- Improved webOS launch/DIAL handling and bundled AAC decoder for livestreams
- Installable `.ipk` package

The configuration screen can be opened with the **GREEN** button on the LG remote.
While a video is playing, press **1** to decrease playback speed or **3** to increase it. Press **0** to toggle subtitles.

## Installation

Download the stable `.ipk` from the [GitHub releases page](https://github.com/RF1705/youtube-webos-cobalt-adfree/releases/latest) and install it using Homebrew Channel, webOS Device Manager, `ares-cli`, or the webOS app install service on rooted devices.

For **v2.0.0**, the package filename is `youtube.leanback.v4_2.0.0_arm.ipk`. It will become available once the stable release is published.

The package uses the original `youtube.leanback.v4` application id to preserve YouTube sign-in and phone pairing compatibility. Installing it replaces the official YouTube application.

### Homebrew Channel repository

Add the following custom repository in Homebrew Channel:

```text
https://raw.githubusercontent.com/RF1705/youtube-webos-cobalt-adfree/main/repo.json
```

The stable Homebrew Channel entry is automatically synchronized when a new stable release is published. Do not install this package alongside another Homebrew package using the same `youtube.leanback.v4` application id.

## Building

Clone the repository:

```sh
git clone https://github.com/RF1705/youtube-webos-cobalt-adfree.git
cd youtube-webos-cobalt-adfree
```

The current Cobalt runtime is built directly for webOS and packaged without an LG Cobalt starter binary. Build helpers and platform patches are contained in `cobalt-platform/` and `scripts/`.

Relevant build scripts include:

- `scripts/build-starterless-cobalt-docker.sh` — builds Cobalt for webOS
- `scripts/package-starterless-cobalt.sh` — creates the application package
- `scripts/build-sdl-webos-docker.sh` — builds the SDL webOS platform dependency

## Development

The web application sources are in `webapp/`.

Run the webapp tests with:

```sh
cd webapp
npm install
npm test
```

## Compatibility

Compatibility depends on the webOS version, TV platform, firmware and Cobalt/Starboard runtime. Please use the issue tracker for current device reports and compatibility problems.

## License

This is a **multi-license project**. The webapp is GPL-3.0-only; project-owned native Starboard/webOS integration uses BSD-3-Clause; upstream Cobalt, SDL-webOS, GCC runtimes, and other dependencies keep their respective terms. See [license scope and third-party notices](LICENSES/README.md). Redistributed IPKs include the relevant license texts in `content/licenses/`.
