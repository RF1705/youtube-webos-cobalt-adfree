# Background audio overlay experiment (Issue #143)

This is a **prototype**, not a working OLED panel power-off implementation.

## Motivation

The reference project [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos)
has a `src/screensaver-fix.js` module that adjusts video sizing and manages
screensaver workarounds. It is **not** an implementation of the webOS Screen Off
energy-saving command, so it cannot be copied for this feature.

Our starterless Cobalt build uses Starfish/native video planes. A fixed HTML
overlay may cover the UI but **not** the decoded video plane. That is the
first hypothesis to verify on an LG TV.

## How to test

1. Build and install **this branch**, not `main`. The JS changes are bundled
   into `adblockMain.js` as part of the existing starterless Cobalt build.
2. Start a YouTube video or music stream with clearly audible audio.
3. Briefly press the **blue remote button** (keycode 406; alias 191).
4. Observe whether **both the UI and the actual video area** become black.
   Keep listening: does audio continue?
5. Change the volume while black; it should remain in the black-screen mode.
6. Press an arrow or OK button: the screen should return and the key should
   not accidentally control YouTube on that same press.
7. Press blue again to toggle, and verify normal playback and navigation.
8. Repeat after video changes and with different output modes/hardware.

Logs are prefixed `[ytaf] Background audio`.

## Known limitations

- No direct `tvpower/turnOffScreen` Luna call and no privilege escalation.
- The panel is **still powered on**. Do not claim power saving equivalent to
  LG's real Screen Off feature.
- The native Starfish video plane may remain visible over the black HTML layer.
- This deliberately omits a long-press visualizer.
- Remote key availability, repeat/keyup delivery, and native volume/power
  handling must be validated on real hardware.

If the native video remains visible, the next prototype should investigate a
native webOS service call and its actual permissions, rather than hiding
or pausing video and claiming screen-off support.
