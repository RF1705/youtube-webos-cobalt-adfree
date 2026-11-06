# PR 136 validation

The C1's reproduced accelerated startup stall and 480p downgrade are fixed.
The final review follow-up also fixes long-GOP and end-of-stream rate timeouts.
Earlier rejected candidates and their findings are retained below as history.

## Follow-up: exact audio seeks and initial-speed playback

Executable: `f86f1113f7d411b71451bdf77db7571a37912f99b262553280724316abec8f96`.

The reported seek target was 2760.028160 s and the first decoded audio timestamp
was 2759.994500 s. Cobalt's SourceBuffer requests the configured Opus preroll,
but clamps it to the available MSE range. Our adapter incorrectly rejected any
non-origin gap below 80 ms. It now calculates the discard from the actual packet
and target timestamps (1,616 samples in this case) and keeps the exact target.
The original stream-origin codec delay is still enforced; the discard limit
comes from the 16-bit Opus header field and the 48 kHz output rate.
See [SourceBufferStream::Seek](https://github.com/youtube/cobalt/blob/23.lts.6/third_party/chromium/media/filters/source_buffer_stream.cc).
The earlier 46.34 ms position-shift workaround was rejected and removed.

The timestamp-correct candidate was tested on the C1 with the exact reported
native timestamps: Load retained 2760.028160 s, reported discard_samples=1616,
and measured playback was 1.7549x over a settled 14.57 s window. Source identity,
frame growth and hardware DISPLAY captures were checked. A second seek with
short preroll also played without a source retry. The first two-case test run
stopped because its second target was already buffered; that run is not counted
as two unbuffered seeks. The later exact-case run was independently collected.

The user clarified the startup report: return from a 1.75x video to the list,
then select another video from the beginning, with about 2–3 s of black screen.
A warm seek is not evidence for that cold-media startup path. Remote tests now
use the actual BACK/list/ENTER flow and record media starting at zero.

For a fresh stream-origin session, native playback now stays paused until Load
completes. The adapter sets the requested initial rate with replay coverage,
re-feeds the flushed data, and waits for accepted audio and video before its
first native Play. Playback therefore starts at the requested speed rather than
playing briefly at 1x and flushing an already-running pipeline. No elapsed-time
fallback or presentation-delay threshold is used for that initial setup. Non-origin seeks
and later rate changes keep the established presentation/headroom checks.
Host tests cover 0.5x/1x/1.75x/2x setup order, independent stream backpressure,
missing replay, initially paused playback, request replacement, seek cancellation,
and disallowing reuse after first Play.
Two native paused-start prototype videos and the final build reached from the
list sustained 1.75x with changing DISPLAY captures. The final run showed its
first moving picture 2.016 s after ENTER and measured 1.7520x over the settled
window. Native Load-to-first-frame took 0.285 s and first Play already used 1.75x.
These are different videos, not a controlled network/cache latency benchmark.
Full navigation still includes client and network work; no sub-second end-to-end
startup claim is made. On the same final binary, the reported seek measured
1.7253x (within the 0.08 tolerance), Normal 1.0012x, and resume 1.7507x. Pause
remained stationary. Normal reload still has a visible temporary black frame;
these checks do not establish zero dropped frames or audible A/V sync.

A prototype that waited for Load completion before feeding was rejected on the
C1: completion requires input. Another attempted full-app cold test was rejected
because the old PID did not exit; a fresh-PID run reset the client speed to 1x
and is only a normal-speed control. An EAC3 video used the legacy backend and is
not evidence for the shared Opus path. These cases are retained in local records.

The scan also stops once a queued later keyframe proves the nearby window
cannot be satisfied and audio is present. It preserves all packets for native-1x
fallback instead of waiting out the two-second deadline. The earlier 3.351 s to
1.773 s comparison measures a warm native resume phase, not cold media startup.
Native production-method tests, session-state checks with UBSan, Python syntax
checks and ARM builds pass. Evidence is local in `pr136-cold-start/` and
`pr136-user-regression/`. Audible A/V sync and other devices remain unverified.

## Previous candidate

Executable: `9ab047e183842e58194efce7e159fc54ee5ade82fbfb1be2aeb7c27db6ed0706`.
The installed running process matched this hash. The owner manually tested this
candidate on the C1 before requesting publication. ARM compilation and the host
regressions below pass. The automated device observations below were collected
on the preceding round-3 binary; the two specific timeout reproductions were
verified with the host fixture.

## Automated device validation: round 3

Executable: `61d1d9d825ebed595a2c946b4a0dce1e61a361a137905f966d13cb073a159c2d`.
Packaged preload: `67e670b92c443151cabcdcae2adf8a494a068e0e7c6f949b83a3777729bc8b3b`.

An overlapping adaptive video config removed the selected SourceBuffer range
after opening frames had been consumed. Forward-only keyframe selection then
left reads pending even with buffered data. The webOS overlay reselects the new
config's preceding keyframe, including after old track-buffer frames drain.
Three native reproduction tests fail without the fix; all four tests pass with
it. Unchanged configurations retain their original behavior.

YouTube's HD speed probes multiply frame rate by speed (60 x 1.75 = 105). The
native 60-fps cap rejected these probes and Auto chose 480p. A scoped Cobalt/
YouTube TV preload correction keeps HD AV1/VP9 probes at their source rate while
preserving the remaining native checks, Auto selection and user preferences.
UHD, AVC and unrelated contexts are unchanged. The cold-launch packaged app
retained Auto 1080p60 at measured 1.7509x and 1.9990x.

All 11 final seek/rate regression observations passed on the AV1 4K/30 stream,
including return to Normal from both sides, pause/resume, repeated seeks and
rapid requests. Frontend tests (32), native production-method tests, UBSan
session-state checks and the ARM build passed. Hardware DISPLAY captures and
running-process hashes were checked. The round-3 report contains per-phase fits.

Local evidence: `C:/Tools/slopbro/pr136-tv-round3/REPORT.md` and the
`final-packaged-quality` / `final-regression` folders in `pr136-tv-round2`.
Physical codec/firmware coverage beyond C1 AV1 SDR and audible A/V sync remain
unverified by the automated device tests.

## Historical round 2: controlled A/B and revised seek recovery

The round-1 candidate below was rejected. The revised local executable is
`bbbd6efe2e92f0e39dc583114c520d99930a8056d76b796ecdf3134ee4048cb8`.
The running `/proc/PID/exe` hash was checked after each installation.

The original PR resumed the 1089.031040 s seek at 1.75x on the same AV1 4K video
where the strict-error candidate failed. Its first keyframe was 3.680107 s early.
The revision therefore preserves the exact target and retained GOP after the
bounded scan, decodes at native 1x, and gates the flushing rate change on at least
two callbacks, native presentation 200 ms beyond the target, 1 s of accepted
video headroom and 200 ms of audio headroom. The revised seek measured 1.7494x
over the settled 14.5 s observation with advancing frames and no source retry.

A transparent rebuild using Cobalt's resume cache and the legacy audio/video
backend was rejected: its clock advanced while the picture froze. Two DISPLAY
captures 20 s apart were byte-identical. An initial-rate-before-feed experiment
also failed its startup stress check. Neither experiment remains in this patch.

Direct `loadVideoById` startup stress tests stall on both the original and revised
builds, but leave the surrounding YouTube UI on the previous title. A separate
Normal-speed start on that path measured 1.0014x. These API-only results are
retained as stress evidence and must be distinguished from normal app navigation.
Read tracing found an outstanding video demuxer read while native input queues
were empty. Increasing the rate timeout or calling SetPlayRate without safe
input is not a demonstrated fix. The temporary upstream read tracing was removed.

Evidence and the expanded regression matrix are in
`C:/Tools/slopbro/pr136-tv-round2/`. Reports retain actual source/video IDs,
dimensions, rate, frame counts, time samples, native logs and hardware captures.
A harness classifier initially treated "half-to-normal" as 0.5x; its original
output is preserved, and the raw samples were revalidated at 1x in the v2 fit.

The final C1 matrix passed all 11 observations: steady 1.75x, a 412.176 s seek,
returns to Normal from 1.75x and 0.5x, sustained 0.5x, pause/resume, repeated seeks
to 1089.031040 s and 12.5 s, and rapid rate requests. Settled slopes were within
0.006x of the requested rate with advancing frames and stable sources. The normal
app deep-link startup test still fails in both the original PR and candidate;
YouTube retries at 480p/1x. Early re-seeking did not fix it. See the round-2 report
for per-phase numbers and remaining gaps. TV restoration is recorded separately.

## Round 1 device findings, 2026-11-05

Tested on the LG C1 with webOS 6.6.0. ARM/Cobalt syntax checks and the incremental
Devel link passed. The running process SHA-256 matched the locally built
candidate: `58f0529fce6e754dc9be11f5c120d903659375fca7e86cc4f59d9fd2b6aef48e`.
Only the executable was replaced for testing; installed app metadata still said
2.0.7 and cannot identify the candidate. Logs were sliced from its launch boundary.

- Steady 1.75x playback advanced at approximately 1.74x based on sustained native
  timestamps, with changing hardware-display frames beyond the stall window.
- A seek to 1089.031040 s was rejected by the tightened seek policy. YouTube
  retried the same position through AV1, VP9 and H.264 players, then displayed
  "Something went wrong". Explicit error reporting alone is therefore not an
  acceptable recovery policy for otherwise ordinary seeks. This needs revision.
- Starting another AV1 video while 1.75x was selected still stalled at 0.5 s with
  three native frame callbacks and triggered the 20-second watchdog. One callback
  before SetPlayRate is not sufficient readiness evidence on this device.
- A separately verified 1.5x -> Normal request reloaded the native session. The
  visible timer then advanced from 16:02 to 16:31 over 28.266 s of wall time,
  consistent with 1x within capture/timer uncertainty, and hardware video changed.
- Laptop microphone recordings at TV volume 12 and 20 contained effectively
  digital silence. Audible output remains unverified; no audio success is claimed.

Compositor-only screenshots omit the video plane. Actual-picture checks used
`com.webos.service.capture/executeOneShot` with `method: DISPLAY`. Remote key
acceptance and the UI's selected speed were not treated as proof of playback.
Ambiguous navigation attempts were excluded from pass claims. The remaining
pause/resume, below-1x reset, stress and cross-firmware matrix is incomplete.

Local evidence is in `C:/Tools/slopbro/pr136-tv-validation/`, including the build
log, source hashes, running-process identity, hardware captures, fresh logs and
timed observation JSON. The previous TV executable, volume and HDMI foreground
were restored after testing; the local candidate and code are preserved.

## Maintainer requests

| Request | Behavior and host evidence |
| --- | --- |
| Remove the unsafe rate timeout | Rate changes on playing/seek sessions require replay coverage, two callbacks, presentation 200 ms beyond the target, and accepted compressed headroom. A new stream-origin session configures its initial rate while natively paused, after Load completion, and accepts replay from both streams before first Play. While native presentation advances, keep waiting safely at the applied rate. After 5 s without forward presentation, report a player decode error without calling SetPlayRate; a fully fed tail waits for native EOS under the existing 20 s watchdog. Tests cover missing history, missing presentation, and a fresh deadline for a new request. |
| Reliable return to Normal | Reload only with a nearby video GOP and a valid Opus plan. Retry while the old session advances, including beyond 5 s for long GOPs at slow rates; fail only after 5 s without forward presentation, except a fully fed tail. Never send SetPlayRate(1.0). The media clock reports the applied rate, including during failure, and zero while paused. Tests cover both 0.5x and 1.75x, cache exhaustion, later coverage, and cancellation. |
| Seek accuracy and fallback | Keyframes may be at most 900 ms ahead, leaving 100 ms for the native start guard; the final snapped start must be within 1 s of the target in either direction. After 2 s of input without a nearby start, preserve the GOP and exact target, decode at native 1x, and gate the later rate flush on presentation and input headroom. Tests cover forward-bound edges, audio pushing the start out of bounds, distant first packets, no packet loss on timeout, and stale generations. |
| Wider regression coverage | The host fixture compiles production Seek, AcquireSeekStart, Start, Time, Rate, Pause, Feed and Step against a fake vendor API. It exercises H.264/VP9/AV1 Load payloads and configuration checks, pause/resume, return to Normal, three successive seeks per codec, stale callbacks, rapid requests and EOS. Physical H.264/VP9/HDR and other webOS versions remain unverified. |

## Error recovery contract

The renderer's existing error callback reports an unavailable rate transition as
a decode error. Seek-scan expiry instead retains the exact-target native 1x path.
Playback is not silently marked successful and no unsafe rate flush is attempted.
Although Owner::Seek clears its own error in the host fixture, Cobalt's
PlayerWorker rejects seeks after a terminal player error. Application recovery
therefore requires player recreation. YouTube's observed recreation resets speed
to 1x; this is a failure, not successful recovery of the requested rate.
The rate deadline measures lack of forward native presentation, not total request age. Repeated callbacks at the same PTS do not extend it. A fully fed tail with established presentation can finish at the applied rate when the required headroom is impossible; the existing 20 s stall watchdog still applies. Timeouts are not promises about firmware call duration. The
existing native API hang/quarantine limitations remain unchanged.

## Host checks

From the repository root in a Linux toolchain:

```sh
c++ -std=c++14 -Wall -Wextra -Werror -I cobalt-platform/webos/arm \
  scripts/test-starfish-av-session-state.cc -o /tmp/av-state
/tmp/av-state
c++ -std=c++14 -Wall -Wextra -Werror -I cobalt-platform/webos/arm \
  scripts/test-starfish-rate-replay.cc -o /tmp/rate-replay
/tmp/rate-replay
python3 scripts/test-starfish-rate-transition.py
git diff --check
```

## Remaining device coverage

Build/syntax-check the ARM adapter with the matching Cobalt and webOS SDK before
packaging. On each available device, record model, webOS version, build identity,
video URL and actual selected codec. At minimum, test H.264 SDR and VP9/AV1 SDR;
include HDR where supported. Repeat on another webOS version when available.

For each codec: play normally; change 1 -> 1.75 -> 0.5 -> 1; pause and resume at
each speed; make rapid successive rate requests; seek forward and backward at
1.75x several times; and run through natural EOS. Require sustained native frame
progress, audible synchronized sound, the requested speed, and no surface loss.
Test a far-keyframe seek as well as a nearby one. If no keyframe/audio start falls within the seek tolerance, the scan must retain
the complete GOP and load the exact requested target at native 1x; it must not
skip five seconds. Verify that the later rate flush waits for forward presentation
and safe replay coverage.

The existing far-keyframe script can require codec evidence:

```sh
python3 scripts/test-tv-seek-far-keyframe.py --tv-control /path/to/tv-control \
  --expected-codec VP9 --device-label 'model / webOS version'
```

Select a video that actually exercises that codec before interpreting the result.
The script fails if the selected or reloaded codec differs. It drives the TV and
is an opt-in device test, not part of the offline host suite. The label is supplied
by the operator; it does not independently detect the firmware version.

## Review follow-up: long GOPs and end-of-stream tails

The follow-up also corrects stale seek-fallback instructions and removes the
misleading suggestion that a terminal Cobalt error can recover through a seek.

Host regressions now cover a six-second GOP with a Normal request at 2 s
while playing at 0.5x. The old code raised a terminal error after five wall-clock
seconds; the revised code keeps the applied 0.5x rate while presentation advances
and reloads at the safe 6 s keyframe eight wall-clock seconds after the request.

A second regression requests 1.75x at 0.1x with 0.8 s remaining and both input
streams fully fed. The old code failed because one second of video headroom
could never arrive. The revised code preserves the applied rate, submits EOS
once, and accepts native completion without an unsafe rate flush. A separate
case confirms that repeated callbacks at an unchanged PTS still expire a
non-EOS request five seconds after its last forward progress.

Both new cases failed against the previous native source and pass against the
updated production methods in the host fixture. The updated candidate was then
installed on the C1, its running executable hash verified, and manually tested
by the owner. The two exact edge-case reproductions remain host tests; the
automated device observations above refer to the preceding round-3 binary.
