# Shared A/V playback speed fixes

The shared Starfish backend needs separate handling for in-place rate changes,
seek preroll and adaptive representation changes. The rate model was verified
against the stock YouTube Cobalt pipeline on the same firmware. These fixes
were developed from LG C1 traces; other firmware still needs device validation.
See [backend lifecycle](shared-starfish-av-backend.md) and
[validation and remaining coverage](playback-rate-validation.md).

## Rate transitions and return to Normal

The shared pipeline loads with `transmission:{"trickType":"client-side"}`,
`seekMode:"keep-rate"` and `forcedPrerollOnPause:true`, matching the stock
YouTube pipeline configuration on this firmware. With that configuration
`SetPlayRate` changes the speed in place: accepted compressed input is not
flushed, so no keyframe wait, replay or reload is needed. On the C1 the applied
rate reaches the decoder and display within 6–19 ms in both directions while
playing (1 → 1.75, 1.75 → 1, 0.5 → 1, 1.75 → 2, and rapid replacements).
Exactly 1x is applied the same way; it is not a special case.

Pause stops the decoder but keeps the applied rate. Firmware Play restores the
previous trick speed (`VDISP_SetSpeed 0` then `1750`), so a rate selected while
paused must not be assumed to have taken effect. The adapter therefore keeps
the applied rate across Pause, defers a different request while paused, and
issues `SetPlayRate` for the new rate immediately before Play on resume. Stock
uses the same order and resumes at the requested rate.

A rejected request is never reported as applied and never replays input the
pipeline already consumed: the adapter keeps the old rate and retries the
in-place call on the next worker step. Only a rejected Normal request uses the
retained histories, reloading at the presented position with a nearby video GOP
and valid matching Opus plan. The reload can show a temporary black picture.
Five seconds without forward presentation raises a decode error; a fully fed
tail with established presentation instead finishes at the applied rate under
the existing 20-second stall watchdog.

A terminal decode error requires Cobalt player recreation; clearing the
adapter's error or seeking alone cannot reset PlayerWorker's error latch.
YouTube retrying at 1x is not successful recovery of a requested faster rate.

## Seek start and exact audio timing

A demuxer seek may restart at a keyframe several seconds before the target.
On the C1, that distant start could present one frame and then stall. The
adapter scans for a nearby keyframe and matching audio before committing a
snapped start. The final start must be within one second of the target; forward
keyframes are limited to 900 ms to leave room for the 100 ms native-start guard.

If no usable nearby start arrives within two seconds of the first queued video
input, or a queued later keyframe proves the window cannot be satisfied, retain
all packets and load the exact target at native 1x. Once that session is
loaded, the requested rate is applied in place like any other change; only a
rejected Normal request waits for retained coverage to reload. This fallback
avoids discarding several seconds of content or failing an ordinary seek. The
exported video window is armed during scanning so window setup can overlap
that work.

Chromium requests Opus preroll but clamps it to the available buffered range.
The adapter calculates discard samples from the actual packet/target gap at
48 kHz, without imposing another 80 ms minimum or moving the target. Original
stream-origin codec delay and the 16-bit discard limit remain enforced. For
the reported target 2760.028160 s and audio timestamp 2759.994500 s, this gives
1,616 samples. No timestamp-offset workaround is used.

## New-video startup

A fresh stream-origin session prepares its requested rate while natively
paused. Feed decoder initialization, wait for Load completion, apply the rate
in place, then Play. This avoids briefly playing at 1x before changing an
already-running pipeline. Later changes and non-origin seeks use the same
in-place call; no gating or startup exception remains. No fixed startup delay
forces the transition.

Adaptive configuration overlap can independently block startup. Replacing an
already selected SourceBuffer range may remove its selection after opening
frames have been consumed. Forward-only keyframe reselection misses the new
configuration's preceding keyframe, leaving reads pending despite buffered
video. The webOS overlay reselects that keyframe only when no forward keyframe
exists and the replacement configuration at the last output PTS differs. It
also handles old track-buffer frames draining after the append. Unchanged
configurations retain the original behavior. The renderer preserves its
presentation position while decoding preroll.

## HD quality at faster speeds

YouTube probes a 60-fps source at 105 fps for 1.75x and 120 fps for 2x. The
native 60-fps capability cap rejects these probes and Auto may choose 480p.
The Cobalt-only YouTube TV preload first preserves native acceptance. For a
rejected HD AV1/VP9 probe, it checks both client speed values and corrects only
an unambiguous recognized source frame rate before retrying the native check. Codec,
dimensions, bitrate and color checks remain intact. UHD, AVC, unknown source
frame rates, other browsers and other sites keep their native results. YouTube
continues to control Auto selection and explicit quality preferences. C1 tests
retained 1080p60 at 1.75x/2x; accelerated 4K/60 is not established.
