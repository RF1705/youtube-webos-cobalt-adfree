# Shared A/V playback speed fixes

The shared Starfish backend needs separate handling for flushing rate changes,
seek preroll and adaptive representation changes. These fixes were developed
from LG C1 traces; other firmware still needs device validation. See
[backend lifecycle](shared-starfish-av-backend.md) and
[validation and remaining coverage](pr136-local-validation.md).

## Rate transitions and return to Normal

On the tested firmware, SetPlayRate flushes accepted compressed input. Calling
it without replay data can leave the native decoder waiting for a keyframe.
The adapter retains bounded audio/video histories and replays matching packets
when changing speed. It preserves replay queues across backpressure and
invalidates stale work when the session generation changes.

Playing sessions and non-origin seeks require replay coverage, two frame
callbacks, presentation at least 200 ms beyond the native target, accepted video
at least one second ahead and audio at least 200 ms ahead. The adapter never
forces a flushing transition on timeout. It keeps reporting the applied rate
while waiting; pause reports zero. Forward native presentation extends the
wait. Five seconds without forward presentation raises a decode error; a fully
fed tail with established presentation instead finishes at the applied rate
under the existing 20-second stall watchdog.

SetPlayRate(1.0) returns success on the tested firmware without restoring the
audio decoder to Normal. Returning to exactly 1x therefore reloads at the
presented position with a nearby retained video GOP and valid matching Opus
plan. It never substitutes an approximate rate or reports an ineffective
command as success. The reload can show a temporary black picture. Firmware
Pause/Play also resets the decoder's rate, so resume reapplies the requested
speed through the safe transition path.

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
all packets and load
the exact target at native 1x. The later rate change still waits for safe
presentation and replay coverage. This fallback avoids discarding several
seconds of content or failing an ordinary seek. The exported video window is
armed during scanning so window setup can overlap that work.

Chromium requests Opus preroll but clamps it to the available buffered range.
The adapter calculates discard samples from the actual packet/target gap at
48 kHz, without imposing another 80 ms minimum or moving the target. Original
stream-origin codec delay and the 16-bit discard limit remain enforced. For
the reported target 2760.028160 s and audio timestamp 2759.994500 s, this gives
1,616 samples. No timestamp-offset workaround is used.

## New-video startup

A fresh stream-origin session prepares its requested rate while natively
paused. Feed decoder initialization, wait for Load completion, apply the rate
with replay coverage, then accept replay from both streams before first Play.
This avoids briefly playing at 1x before flushing an already-running pipeline.
The exception ends at first Play; later changes and non-origin seeks retain
the presentation/headroom gate. No fixed startup delay forces the transition.
The opt-in replay-disabled diagnostic path remains separate from this normal
startup sequence and retains its existing empty-pipeline rate attempt.

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
The Cobalt-only YouTube TV preload normalizes recognized speed-scaled HD
AV1/VP9 probes to their source frame rate before the native check. Codec,
dimensions, bitrate and color checks remain intact. UHD, AVC, unknown source
frame rates, other browsers and other sites keep their native results. YouTube
continues to control Auto selection and explicit quality preferences. C1 tests
retained 1080p60 at 1.75x/2x; accelerated 4K/60 is not established.
