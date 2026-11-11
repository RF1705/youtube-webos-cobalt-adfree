# Native webOS Screen Off experiment (Issue #143)

This test calls the **real webOS Luna tvpower API** from the native
starterless-Cobalt SDL input loop. There is **no HTML black overlay**.

The [NicholasBly/youtube-webos](https://github.com/NicholasBly/youtube-webos)
screensaver workaround adjusts video sizing; it does not implement this Luna
screen power operation.

## Experiment

- Blue remote key (mapped to `kSbKeyBlue`): request
  `luna://com.webos.service.tvpower/power/turnOffScreen`.
- Another blue key or an arrow/OK key: request
  `luna://com.webos.service.tvpower/power/turnOnScreen`.
- Volume and power keys do not trigger a wake request.
- No media playback state is changed by this experiment.
- The native app uses its existing libhelpers app-named Luna connection.
  No root, extra service, or custom privilege escalation is added.

## Test on the TV

1. Build/install the starterless-Cobalt **IPK from this branch** (a webapp-only
   build is insufficient because the change is in native C++).
2. Play a music video or podcast and press the blue remote key briefly.
3. Check whether the **physical panel** goes dark and sound continues.
4. Press volume +/- (should remain dark); then press OK/arrow (should wake).
5. Press blue again and repeat for another stream.
6. Inspect Cobalt native logs for `[background-audio]` including the
   `tvpower reply` JSON and errors.

## Interpretation

- `tvpower request sent` means Luna accepted dispatch, **not** that the
  screen actually switched off.
- `tvpower reply` with `returnValue: false` / permission-denied means the
  installed app cannot call that service with its current webOS permissions.
- If native SDL does not receive the blue key or the call is blocked, record
  the TV model, webOS version, and logs before changing implementation.
- We intentionally avoid a silent black-screen fallback; this branch is
  designed to determine whether **native Screen Off** is viable.

This is untested on real LG hardware. A power-off request and subsequent
screen-on request need to be verified before merging or shipping.
