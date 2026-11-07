# Playback speed validation

## Current build and method

The in-place rate transition was tested on an LG C1 / webOS 6.6.0.
Running executable and packaged preload hashes were verified before and after
the tests. Native timestamps, stable source identity, frame growth and hardware
DISPLAY captures were checked; a selected speed or advancing UI clock alone
was insufficient. Compositor captures omit the video plane.

- Final candidate, including the rejected-call fallback fix: `49bb4718c432e84c3237cd846a6e47d83f37ac1c7bc5b24cd3482c927e4897d0`.
  Device smoke: Normal 1.0010x, 1.75x 1.7511x/1.7538x, paused 1.75x -> Normal -> resume 1.0003x.
- Full rate matrix measured on the earlier in-place candidate
  `b8b60ada9e118db0b7a65f834b3d7be5a67146ba60fdcea08aff8790d39e02b5`; the final
  candidate differs only in rejected-call handling and removed diagnostic startup.
- Trusted binary restored afterwards: `a124a392fecd20cbeeb939186dde24741aa27c3a89e7ec26ea711bfe7a896561`.
- Preload: `19df0d76b16c790f21f5c9c7b9aa26a6365de60e7efb067a20b6538137358ef5`.

The reference for the transition model is the stock 1.1.7 Cobalt 22.lts.6
pipeline on the same TV. Native trace showed one
`SetPlayRate {"playRate":<n>,"audioOutput":true}` on the existing object per
change, with no Load/Unload, and the driver applied `VDISP_SetSpeed`/SOLA within
about 10 ms. Selecting Normal while paused sent `SetPlayRate 1` and then Play,
resuming at 1.0x. The adapter now uses the same in-place call on a pipeline
loaded with the stock trick-play options.

| Device check | Measured result |
| --- | --- |
| 1.75x while playing | 1.7503x, 1.7462x; `VDISP_SetSpeed 1750`, SOLA 1.75 |
| 1.75x -> Normal while playing | 1.0013x; `VDISP_SetSpeed 1000` ~6 ms after the call |
| paused 1.75x -> Normal -> resume | stationary while paused; 0.9882x after resume |
| 0.5x, then Normal | 0.5004x, then 0.9993x |
| rapid 1.75/0.5/2/1.75 | settled 1.7438x; `VDISP_SetSpeed 2000` then 1750 |
| seek to 1200 s at 1.75x | 1.7457x after seek; rate re-applied in place |
| new video at retained 1.75x | 1.7199x; initial rate applied before first Play |

All fits use the existing 0.08 tolerance and require stable source identity,
forward player time, frame-count growth and no error. Driver logs confirm
`VDISP_SetSpeed` 1750/1000/500/2000 matching each request and no pipeline
reload during any rate change. Raw logs, fits and captures remain in local
evidence outside the repository.

The trusted native binary and preload are left installed with playback paused
at verified Normal and the previous volume restored. The experimental candidate
remains outside the repository. Neither instant recovery on rejected calls,
zero dropped frames nor audible A/V synchronization is claimed.

## Host coverage

The transition policy is compiled directly. The vendor fixture compiles the
production adapter and reload-claim helper against a fake Starfish API; it
checks adapter decisions, ownership and call order, not firmware semantics.

- In-place 0.5x/1x/1.75x/2x changes: exact payload, applied rate, no replay,
  no flush and no reload; identical requests are no-ops.
- Pause keeps the applied rate; a request while paused is deferred and sent
  immediately before Play on resume.
- A transient rejection retries in place with no replay queued; rejected
  requests never claim success, and a rejected Normal request publishes the
  retained-GOP reload fallback.
- Initial rate before first Play, paused startup, versioned request replacement,
  seek/pause cancellation of a reload and one-time ownership transfer.
- H.264/VP9/AV1 payloads/configurations, repeated seeks, stale callbacks,
  bounded replay, exact Opus discard and stream-origin codec delay.
- Bounded seek snapping and exact-target fallback without packet loss.
- Rate diagnostics bounded in Devel and silent in Gold/QA/Debug; frontend
  correction for disagreeing speeds, ambiguous probes and native acceptance.

Native regressions, session-state checks with UBSan, bounded replay, the
transition harness (including a transient-rejection regression that fails on
the previous replaying fallback), all 34 frontend tests and the ARM build
(`49bb4718…`) pass. CI runs the same host checks on every push, with UBSan
enabled for the session-state test. Earlier validation of the unchanged
SourceBuffer fix passed four actual ARM tests; three fail without the fix.
That gtest (`webos_source_buffer_config_overlap_test`, added by the overlay
patch) is built and run manually on the ARM Cobalt tree only; no CI job
builds Cobalt. Earlier device matrices add repeated-seek and Auto
1080p60 coverage, rather than a fresh run of every case on this binary.

Run host checks from the repository root with a Linux toolchain:

```sh
c++ -std=c++14 -Wall -Wextra -Werror -fsanitize=undefined \
  -I cobalt-platform/webos/arm scripts/test-starfish-av-session-state.cc \
  -o /tmp/av-state
/tmp/av-state
c++ -std=c++14 -Wall -Wextra -Werror -I cobalt-platform/webos/arm \
  scripts/test-starfish-rate-replay.cc -o /tmp/rate-replay
/tmp/rate-replay
python3 scripts/test-starfish-rate-transition.py
python3 -m py_compile scripts/test-tv-seek-far-keyframe.py
(cd webapp && npm test && npm run build -- --env production --optimization-minimize)
```

## Remaining device coverage

Current physical coverage is C1 AV1 + Opus SDR. H.264/VP9/HDR, other webOS
versions, sustained playback and audible A/V sync need further device checks.
Laptop microphone capture has not established audible output.

For each device/codec, record firmware, binary identity, URL and actual codec;
check 1 -> 1.75 -> 0.5 -> 1, pause/resume, rapid requests, repeated forward/backward
and far-keyframe seeks, and natural EOS. Require sustained picture progress,
measured speed, stable source and synchronized sound. The opt-in seek helper
supports `--expected-codec` and an operator-supplied label:

```sh
python3 scripts/test-tv-seek-far-keyframe.py --tv-control /path/to/tv-control \
  --expected-codec VP9 --device-label 'model / webOS version'
```
