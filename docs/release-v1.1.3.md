# v1.1.3

This maintenance release fixes advertisements appearing while scrolling
between videos in the YouTube Shorts reel.

## Fixed

- Shorts entries marked with YouTube's newer `REEL_VIDEO_TYPE_AD` schema are
  now removed before the reel is rendered.
- Advertisement markers are recognized across the known command, navigation,
  reel item and tile endpoint layouts.
- The string value `"false"` is no longer treated as an advertisement marker.

The updated detection follows the schema used by the current NicholasBly
YouTube webOS fork while keeping the existing recursive response filtering.

Thanks to [TheKnight-Dev](https://github.com/TheKnight-Dev) for reporting the
problem in [issue #8](https://github.com/RF1705/youtube-webos-cobalt-adfree/issues/8).

Install `youtube.leanback.v4_1.1.3_arm.ipk` directly or use the custom Homebrew
Channel repository listed in the README.
