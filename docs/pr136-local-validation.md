# Playback speed validation

## Scope and method

Device checks used an LG C1 running webOS 6.6.0. Remote observations verified
actual selected codecs, the running executable SHA-256, native presentation
progress and hardware DISPLAY captures. A selected speed or advancing UI clock
alone was not accepted as evidence. Compositor-only screenshots omit the video
plane and were not used to establish picture progress.

The latest device-tested executable was:
`f86f1113f7d411b71451bdf77db7571a37912f99b262553280724316abec8f96`.
The subsequent cleanup extracts methods and removes an unreachable branch.
Its native regressions, UBSan checks, frontend tests/build and ARM build passed;
it has not been retested on the TV. The observations below refer to the
executable above.

## Device observations

- **New video at retained 1.75x:** used BACK -> list -> ENTER, starting the new
  video at zero. The first moving picture appeared 2.016 s after ENTER. Native
  Load-to-first-frame was 0.285 s; first native Play already used 1.75x. Settled
  playback measured 1.7520x with changing DISPLAY captures. Client/network work
  still contributes to navigation latency; this is not a sub-second startup claim.
- **Reported seek:** target 2760.028160 s, first decoded audio 2759.994500 s.
  Load retained the exact target and used 1,616 discard samples. The latest
  build measured 1.7253x within the test's 0.08 tolerance, with advancing frames.
  The preceding exact-timing candidate measured 1.7549x over 14.57 s.
- **Normal, pause and resume:** the latest build measured 1.0012x at Normal and
  1.7507x after resume; pause remained stationary. Returning to Normal still
  reloads the native pipeline and can show a temporary black picture.
- **Broader regression matrix:** an earlier candidate passed 11 observations
  covering 1.75x, 0.5x, returns to Normal from both sides, repeated seeks,
  pause/resume and rapid requests, with stable sources and advancing frames.
- **Auto quality:** the packaged capability correction retained Auto 1080p60
  at measured 1.7509x and 1.9990x. This does not establish accelerated 4K/60.

The owner also manually tested the installed candidate before publication.
Earlier matrices support regression coverage; they are not fresh runs of every
case on the latest executable. Local raw logs, per-phase fits and captures are
retained outside the repository. Rejected prototypes and ambiguous navigation
attempts are excluded from pass claims.

## Host coverage

The transition fixture compiles production Seek, AcquireSeekStart, Start, Time,
Rate, Pause, Feed and Step, including the rate helpers, against a fake vendor API.
It checks adapter behavior, not firmware semantics or physical synchronization.

- Initial 0.5x/1x/1.75x/2x Load/rate/replay/Play ordering; independent audio/video
  backpressure; initially paused startup; missing replay; request replacement;
  seek cancellation; and no reuse of the initial-start exception after Play.
- H.264/VP9/AV1 Load payloads, configuration checks, repeated seeks, stale
  generations/callbacks, rapid requests, bounded replay and packet retention.
- Exact Opus timestamp discard, stream-origin codec delay and the 16-bit bound;
  bounded seek snapping and exact-target native-1x fallback without packet loss.
- Return to Normal from 0.5x and 1.75x, cache exhaustion and later coverage.
  A six-second GOP at 0.5x keeps waiting while presentation advances; a fully
  fed tail finishes via native EOS when rate-change headroom cannot be met.
  Repeated callbacks at an unchanged PTS do not extend the five-second deadline.
- Rate diagnostics enabled and bounded in Devel; silent in Gold/QA/Debug.

The actual ARM SourceBuffer overlap tests passed all four cases; three changed-
configuration cases fail without the patch. Frontend tests (32) and the packaged
frontend build passed. Session-state tests also passed with UBSan, and the
native adapter built successfully for ARM.

Run the host checks from the repository root with a Linux toolchain:

```sh
c++ -std=c++14 -Wall -Wextra -Werror -fsanitize=undefined \
  -I cobalt-platform/webos/arm scripts/test-starfish-av-session-state.cc \
  -o /tmp/av-state
/tmp/av-state
c++ -std=c++14 -Wall -Wextra -Werror -I cobalt-platform/webos/arm \
  scripts/test-starfish-rate-replay.cc -o /tmp/rate-replay
/tmp/rate-replay
python3 scripts/test-starfish-rate-transition.py
(cd webapp && npm test && npm run build -- --env production --optimization-minimize)
git diff --check
```

## Remaining device coverage

Physical coverage for this update is C1 AV1 + Opus SDR. H.264/VP9/HDR, other
webOS versions, sustained playback and audible A/V synchronization need further
device checks. Laptop microphone capture did not establish audible output.
Frame progress does not establish zero dropped frames or synchronized sound.

On each available device, record model, firmware, running binary identity,
video URL and selected codec. Test 1 -> 1.75 -> 0.5 -> 1, pause/resume, rapid
requests, repeated forward/backward seeks, far-keyframe seeks and natural EOS.
Require sustained picture progress, measured requested speed, stable source,
audible synchronized sound and no surface loss. The opt-in seek helper supports
codec evidence:

```sh
python3 scripts/test-tv-seek-far-keyframe.py --tv-control /path/to/tv-control \
  --expected-codec VP9 --device-label 'model / webOS version'
```

The device label is operator supplied. Independently verify hardware picture
and audio; the script's native-log result alone is insufficient.
