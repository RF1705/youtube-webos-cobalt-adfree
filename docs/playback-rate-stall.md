# Shared A/V playback-rate investigation, 2026-09-26

Read-only TV diagnosis; no runtime, marker, or playback settings changed by the
diagnostic session. User changed playback speed with the remote. Installed app
reports version 2.0.5; the native LOAD payload matches the shared AV1/Opus path
in this checkout. Exact binary/source identity was not established.

## Observations

Times below are UTC (TV local time was UTC+2). Native records came from
`/var/log/messages`, its rotated archive, and `/var/log/legacy-log`.
The current process writes stdout/stderr to a pipe; `/tmp/cobalt-starterless.log`
stopped updating at 20:50 local and must not be used for the subsequent test.
Selected raw evidence is saved locally in the ignored
`output/diagnostics/playback-rate-2026-09-26.log`.

Both observed sessions loaded AV1 + OPUS, 1920x1080, in one BUFFERSTREAM player.

1. At 18:53:09.639, session `_oyX1rn1IZ8GN8k` receives
   `SetPlayRate({"playRate":1.25,"audioOutput":true})`.
   Audio and video sinks receive flush-start/flush-stop with reset_time=1.
   Audio receives a new 1.25 segment and prerolls at 136.981 seconds,
   then waits for PLAYING. The inspected interval contains no corresponding
   video preroll or return to PLAYING. Hardware audio subsequently reports
   play=0, empty ES/PCM, STC=0. Session unload starts at 18:53:29.503.

2. At 18:57:04.197, session `_J6dCtt1uW2KJF0` receives 1.25x.
   Both streams are flushed again. New segment start: 8.323166 seconds.
   Audio preroll: 8.761 seconds. Video preroll: 13.189833 seconds.
   Both sinks transition to PLAYING. Video reports OutputBuffer Idle Cost:3719
   and Start Show_Frame at 18:57:08.169. Thereafter native counters advance
   at approximately 75 frames/s with 60 vsync/s. The user reports audible audio.
   Thus 1.25x does not invariably stop native decoding or native presentation.

3. At 18:57:18.228, that same session receives 1.5x.
   Both streams flush. Audio prerolls at 26.061 seconds for a segment starting
   at 25.539833 seconds, then waits for PLAYING. No corresponding video segment/
   preroll or PAUSED-to-PLAYING transition was found in the inspected interval.
   Hardware audio reports play=0 and empty ES/PCM. Unload begins at
   18:57:38.064, approximately 20 seconds after the rate change.

## Code correlation

`starfish_av_components.cc` changes the native rate directly in `Step()`.
It does not coordinate a demuxer seek, replay compressed data, or establish a
fresh video keyframe boundary for a rate change.

`StarfishAvSessionState::CompleteFeed()` removes each accepted packet from the
application queue. Native acceptance is not proof that the packet has already
been presented, so a later native flush can discard data that the application
no longer retains.

`Feed()` limits both streams to `current_ + 5 seconds`. `current_` advances only
from FRAMEREADY callbacks. If a native flush needs a subsequent decodable frame
outside this window, input cannot reach it while the presentation clock is
stalled. `Step()` then reports an error after 20 seconds without frame progress.

## Assessment and remaining uncertainty

Confirmed: on this firmware, a native rate change flushes both streams. One
change resumes with an approximately 4.43-second gap between initial audio/video
PTS; other changes remain waiting for preroll until teardown. This is more
specific than a generic Opus decoder failure or merely missing time callbacks.

Leading hypothesis: our adapter treats a flushing rate change as a continuous
rate update. Lost buffered video/reference data and the frame-clock-based feed
limit can prevent video preroll from completing; the shared pipeline then cannot
resume audio either. Keyframe loss and the exact feed-limit deadlock still need
packet-level confirmation; the logs do not expose accepted packet PTS/keyframe
flags or our queue state at the stall. No fix has been validated.

Next diagnostic build should record bounded before/after rate snapshots:
requested/applied rate, native frame callback count and PTS, last accepted and
next queued PTS per stream, keyframe flags, feed-limit hits, and relevant native
state events. Test either a supported non-flushing rate transition or a
coordinated seek/re-preroll from a valid keyframe with aligned Opus timing.
Do not simply disable the stall watchdog or unbound the input queue.

## Reproduction on 2.0.7, 2026-10-30

Updated the local main checkout by fast-forward from a765486 to 94960c0.
The installed app reports 2.0.7; running Cobalt PID 28848 selects shared
AV1/Opus at 1920x1080. Binary/source identity was not verified. The rate/feed
logic above is unchanged in the updated checkout. TV access was read-only;
the user changed speed and reported frozen video and missing sound.

Current evidence (timestamps UTC; TV local time CET):

- At 20:45:38.238–38.265, audio and video receive flush-start/flush-stop,
  resetting time. Both sinks receive a 1.25x segment starting at 192.2065 s.
- Audio prerolls at 192.841 s and waits for PLAYING. Video receives the new
  segment, but no video preroll is present before teardown in the captured
  interval. This narrows the failure beyond merely missing a video segment.
- From 20:45:40 through 20:45:55 the hardware audio counters repeatedly show
  play=0, empty ES/PCM, STC=0. Video frame-counter reports cease after the flush.
- Cobalt reports `shared A/V presentation stalled for 20 seconds` at
  monotonic_us=4927504415, then unloads the session. Its aggregate feed-retry
  counters are zero for both streams: native BufferFull/Pending was not observed
  in this session. This does not exclude the adapter's own five-second limit.
- A new session loads target 192.538272 s with video starting at 190.133333 s
  and audio at 192.4345 s. The native segments now have rate=1.0. Video preroll
  completes at 20:45:59.852 and first-frame is recorded at
  monotonic_us=4929256177. Recovery therefore does not prove 1.25x works.

This confirms the flushing rate-transition/preroll failure on the current
installed version. Loss of a necessary keyframe/reference chain and a stall
at the five-second feed limit remain hypotheses pending packet diagnostics.
A candidate fix should coordinate a demuxer seek/re-preroll at the current
position and preserve the requested rate, supplying video from a valid
keyframe and aligned audio. A blind native session reset cannot do that:
accepted compressed packets have already been removed from the queues.
No runtime fix was installed or validated.

Raw excerpts are in ignored `output/diagnostics/playback-rate-2026-10-30-*.log`;
`-preroll.log` captures the transition and `-transition.log` includes the
native audio rate setter reporting 1.250000 before the 20-second timeout.

## Experimental bounded packet replay (branch `fix/playback-rate-repreroll`)

The candidate implementation takes a more local approach than the demuxer seek
outlined above: retain owning references to successfully accepted compressed
packets, then replay them after a successful native `SetPlayRate` flush. It does
not create a new native session or change YouTube's media time. Native segment
clipping and decoder flushing must handle the replayed pre-target packets; this
firmware assumption remains to be validated on the TV, including audio pre-skip
and A/V synchronization. API acceptance alone is not validation of this fix.

- Video retention starts at the latest keyframe at or before the presentation
  clock, and includes all subsequently accepted packets. Bounds are 2048 packets
  and 16 MiB; exceeding either may discard the needed keyframe. Replay is then
  unavailable until a complete GOP is retained again. Oversized packets clear
  the history so that subsequent packets cannot conceal a gap.
- Audio retains the preceding 100 ms and accepted lookahead, bounded to 1024
  packets and 1 MiB. Replay requires audio coverage at the current position and
  a retained video keyframe at/before that position. This is compressed-packet
  coverage, not proof of decoder preroll success.
- Replayed packets do not consume newly queued packets. BufferFull/Pending keeps
  the same replay packet for retry. Both replay queues drain before normal feed
  resumes; input EOS remains recorded, and native EOS is resubmitted after replay.
- A normal seek destroys this generation's session/history. Rapid rate changes
  replace the pending replay with a fresh snapshot. Pause/resume at the same
  positive speed does not cause an extra SetPlayRate or replay.
- The five-second feed limit and 20-second stall watchdog remain in place. No
  native calls or logging are added to firmware callbacks; callbacks only update
  diagnostic atomics in addition to their existing behavior.
- Retention adds at most 17 MiB of compressed payload plus bounded reference and
  container overhead per session. Replay snapshots share the same payloads;
  fresh queue data retains the existing separate limits. History is retained in
  diagnostic-only mode too, so coverage logging stays comparable.

The candidate is enabled by default **on this branch**. To compare logs without
replay, set `YTAF_RATE_REPLAY=0` before launching, or on the TV:

```sh
printf '0\n' > /tmp/ytaf-rate-replay.enable
```

Fully terminate and relaunch the app after changing the marker. Remove the
marker (or write `1`) and relaunch to test replay. The environment variable takes
precedence. This switch affects only the replay experiment; existing shared A/V
selection is unchanged. It was not changed on the TV during implementation.

`[YTAF rate monotonic_us=...]` logs have their own 512-line process budget, separate
from ordinary playback tracing; they remain inside the existing bounded Cobalt
log. Restart the app for a fresh diagnostic budget. Logs include:

- Requested/applied rate and before/after native-call snapshots.
- Audio/video cache coverage and first retained timestamps.
- The first 24 accepted packets per transition (stream, timestamp, keyframe,
  replay flag, normal queue depth/bytes).
- Once-per-second snapshots for 21 seconds: native frame count/time, last accepted
  and next queued timestamps/keyframe, last accepted keyframe, feed-limit hits,
  native retry totals, replay depth/head timestamps, and native event counters.
- First forward frame progress after the transition, replay drain, and stall.

Packet logging is sampled; the snapshots/retention tests establish queue behavior
but do not expose every firmware decoder decision. In particular, a pending
asynchronous native flush could still discard replayed input after SetPlayRate
returns. Compare native flush/preroll logs with replay timestamps on the device.

### Validation and next device check

Host tests cover bounded history, reference lifetime, missing keyframes/audio,
byte/count eviction, input/native EOS, and compile the actual production Feed,
RateSnapshot and Step methods against a fake vendor API. That regression covers
flushing speed changes, retries, new input isolation, pause/resume, rapid changes,
seek invalidation, disabled replay, rejected rate requests and the feed limiter.
They do not emulate LG firmware or establish audible synchronization.

```sh
c++ -std=c++14 -Wall -Wextra -Werror -I cobalt-platform/webos/arm \
  scripts/test-starfish-rate-replay.cc -o /tmp/ytaf-rate-replay-test
/tmp/ytaf-rate-replay-test
python3 scripts/test-starfish-rate-transition.py
```

The existing shared A/V timing/state tests also pass. CI runs all three suites.
A full ARM/Cobalt build and device validation remain required; the SDK and Cobalt
build tree are not installed in this local workspace. No new IPK was installed.

On the same AV1/Opus video, compare diagnostic-only versus replay at 1 → 1.25 →
1.5 → 2 → 1, then pause/resume, seek while accelerated, rapid changes and natural
EOS. Verify several seconds of forward frame timestamps at the requested speed
and audible, synchronized sound. `rate-frame-progress` alone is insufficient:
recovery must remain stable and must not be a replacement session at 1x.
Also check VP9/H.264 shared sessions and high-bitrate UHD cache exhaustion. If
`audio_covered=0` or `video_covered=0`, no replay was attempted and the trace does
not test the candidate recovery path.
