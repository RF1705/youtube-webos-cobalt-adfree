# Shared Starfish A/V backend (starterless beta)

The webOS starterless Cobalt player now selects one native Starfish session and
one presentation clock by default for eligible YouTube WebM Opus streams with
H.264, VP9 or AV1 video. AAC, DRM, audio-only, unsupported codecs and unsupported
configurations retain the existing Cobalt player factory. This change does not
alter the platform's video capability advertisement or the standard-app build.

The shared player owns both compressed-input queues, serializes vendor API calls
on one thread, and uses native frame timestamps as Cobalt's media time. It
recreates both native streams on a seek, preserves compressed buffers across
`BufferFull` retries, and distinguishes input EOS from native EOS. Normal WebM
Opus end padding is accepted; Starfish has no per-packet back-clipping API, so
the decoded tail may exceed the container end by at most one Opus packet.

## Rollback and diagnostic modes

The backend mode is latched at the first query in each Cobalt process. With no
override, mode 3 supports eligible H.264 SDR and VP9/AV1 UHD SDR/HDR streams.
Set `YTAF_SHARED_AV=0` before launch to use the existing backend. On a rooted
TV, the diagnostic marker can also be set to `0`, `1`, `2` or `3`:

```sh
printf '0\n' > /tmp/ytaf-shared-av.enable
```

Fully terminate and relaunch YouTube after changing it. Removing the marker
restores the default shared mode on the next process; `/tmp` is cleared on TV
reboot. Modes 1 and 2 respectively limit the shared backend to H.264 SDR and
VP9/AV1 UHD SDR. They do not force YouTube's codec choice; an ineligible player
falls back to the existing factory.

## Session replacement

A native session is replaced in two situations, and both use
one shape: the new session starts from a keyframe-anchored position and is
primed with retained compressed packets.

- **Seek**: the start is the snapped keyframe near the target (below).
- **Rate change (fallback only)**: the pipeline loads with the stock trick-play
  configuration (`transmission:{"trickType":"client-side"}`,
  `seekMode:"keep-rate"`, `forcedPrerollOnPause:true`), so
  `StarfishMediaAPIs::SetPlayRate` changes speed in place for every positive
  rate, including exactly `1.0`. Measured on the C1, `VDISP_SetSpeed` and the
  SOLA audio configuration follow the call within 6–19 ms while playing, with no
  input flush, replay or reload. If the native call is rejected, a request for
  Normal still reloads the native session at the presented position from the
  retained GOP, which starts at 1x. That costs one vendor pipeline reload
  (~0.3 s of blank picture); it is accepted over faking the rate with 0.999,
  which would leave playback 0.1 % fast for the rest of the video.
  A reload requires replay coverage, a presented frame, a valid Opus pre-roll
  plan, and a video keyframe within 1 s of the new start. If these are missing,
  the request stays pending while the existing session continues at its applied
  speed; the bridge retries as new packets and keyframes arrive. It never
  rewinds video without matching retained audio. Forward native presentation
  extends the wait, so a long GOP at a slow applied speed does not turn healthy
  playback into a terminal error. After 5 s without forward presentation, the
  bridge reports an explicit decode error through the existing player error
  callback. Cobalt requires player recreation after that terminal error; a seek
  alone cannot clear its error latch. The applied rate is unchanged on failure.

A successful in-place change stays in the existing session and keeps its
exported window. The worker-owned `StarfishRateTransition` policy now runs only
after a rejected native call: it chooses one explicit action: keep the applied
rate, wait for safe input, reload for Normal, or fail after no forward progress. It owns no packets and makes no vendor calls. Readiness
checks inspect retained coverage; owning replay snapshots are copied only when
the policy permits a transition.

Pause keeps the applied rate. Firmware Play restores the previous trick speed,
so a request selected while paused is deferred and applied immediately before
Play on resume.

Rate changes, pause changes and seeks advance a request revision. A pending
Normal reload packages its generation, revision, exact target and retained audio/
video together. The worker claims it once through `TakeRateReload`, validating
the revision immediately before committing to Unload. Withdrawing Normal,
replacing a request (even back to the same numeric value), pausing or seeking
before commitment cancels the queued reload. After commitment, later rate requests
are handled by the replacement session; synchronous vendor calls cannot be
cancelled halfway through Unload. A concurrent seek invalidates the generation
without clearing packet storage already owned by the worker.

## Seek retarget

A demuxer seek restarts at the video keyframe at or before the seek target,
which can be several seconds earlier. The native session only advances when the
first video frame it decodes is close to `ptsToDecode`: with a GOP that started
5.7 s before the target it presented exactly one frame, never advanced, and the
20 s stall watchdog then failed the player, so YouTube reverted playback to 1x.

Every seek therefore retargets its native start to the first video keyframe
inside a ±1 s window around the target. Forward candidates are limited to
900 ms so the 100 ms native-start guard fits inside that same tolerance. The
actual snapped start, including audio pre-roll adjustments, must also remain
within ±1 s. The retarget holds the demuxer's restart GOP — the
input caps are raised while it scans, because a 4K GOP is hundreds of packets —
and commits in one step only when that keyframe and the matching audio are both
queued. Commit releases the skipped packets from the bridge queue in feed order
(`Write` already took ownership from the player) and starts the session on the
keyframe; nothing is released before that, so a retarget that finds no usable
keyframe within 2 s of the first video input keeps the exact requested target
and loads the retained GOP at native 1x. No packets are released in this case.
The rate transition stays gated until native presentation passes the target
and accepted input has sufficient headroom. This avoids a fatal error/retry loop
without silently skipping several seconds of content. With a snapped start,
the chosen keyframe is fed first and
`ptsToDecode` is set 100 ms
after it, so the first native video frame precedes the native target by about
100 ms. Audio keeps at most 100 ms of pre-roll before that keyframe, which keeps
the Opus discard within its 16-bit sample limit, and native and audio
timestamps keep the same epoch. The app-facing current time is the snapped
start, within the accepted seek tolerance of the requested position. A seek that
already restarts near its target keeps the previous behavior unchanged and
releases nothing.

A recreated session that a seek snapped starts native playback at 1x until the
rate transition is safe to issue (see `docs/playback-rate-stall.md`). The
exported video window is armed while the retarget scans the GOP, so the ~0.5 s
of SDL and compositor work overlaps the scan instead of delaying the first
picture.

Devel builds log one `seek-retarget` line per seek (requested target, chosen
keyframe, native start, skipped packet counts, `given_up`) and up to four
`seek-progress` lines after a retargeted start (native frame count and
presented timestamp). `scripts/test-tv-seek-far-keyframe.py` drives the TV and
checks either a bounded snap or an exact-target fallback and requires sustained
native progress at 1.75x for over 10 s; it exits 77 when no TV is reachable.
Its native-log result still needs independent hardware-picture and audio checks.
Use `--expected-codec H264`, `VP9`, or `AV1` to require actual codec evidence and
`--device-label` to record the model/webOS version for each run.

## Safe rate deferral and reporting

Accelerated new-video startup also needs the webOS SourceBuffer configuration
overlap patch installed by `install-webos-starboard-platform.sh`. Without it, an
adaptive representation switch can leave Cobalt's video read pending even though
the stream is buffered. The rate gate cannot fix missing demuxer output. See
`docs/playback-rate-stall.md` for the root cause and the separate HD quality fix.

Successful rate changes apply in place immediately on a loaded, playing
session, including after a seek, with no coverage gates. The media-time
provider reports the applied native rate, not the requested rate; pausing
reports zero. Only a rejected Normal request publishes a reload, and that
reload requires retained replay coverage plus a valid Opus restart plan from
the presented position; it never replays into the live pipeline. Until the
coverage exists the request stays pending and playback continues at the applied
rate. It fails explicitly only after 5 s without forward native presentation.
Fully fed tails with established presentation keep playing at the applied rate
and finish via native EOS; the existing 20 s stall watchdog remains active.

Pause keeps the applied rate; Play restores the previous native trick speed.
A rate selected while paused is therefore deferred, and resume sends
`SetPlayRate` for the requested rate immediately before Play. The native
behavior is measured on the C1 (`VDISP_SetSpeed 0` on pause, the previous
speed on Play) and still needs other-device checks.

Disabling replay is diagnostic only: it removes the Normal reload fallback and
leaves the in-place retry, but never changes a successful rate transition. See
`docs/pr136-local-validation.md` for host coverage and the remaining TV matrix.

## Verification and limits

The native session-state/timing tests, ARM/Cobalt syntax checks and a full Gold
link are required before packaging. TV traces should show `selected shared
AV1+Opus backend` (or the corresponding VP9/H.264 marker), load completion,
first-frame recovery after seek, successful Unload, and `push-eos` followed by
`native-eos` for a natural completion. Collect the video URL, quality changes,
subjective A/V sync, app-switch behavior and any native error.

TV diagnostics so far exercised 4K HDR10 playback with native EOS and an
interactive 4K/1440p/1080p SDR session with repeated seeks, pause/resume and
app switching. Sustained 30–60-minute playback, AAC fallback, VP9/HLG, and
front-discard/MSE-discontinuity inputs still need broader device coverage.
Unsupported timing within an already selected Opus player reports a decode
error rather than switching backend mid-playback. A missing vendor Unload
completion quarantines that session until Cobalt restarts; a synchronous
vendor API hang cannot be cancelled by this implementation. These risks should
remain visible in the PR until follow-up TV tests are complete.

The demuxer requests configured Opus seek preroll but clamps to the available
MSE range. The native adapter accepts that actual gap and calculates the discard
in 48 kHz samples without moving the requested position. The original codec
pre-skip is still enforced at stream origin, and the 16-bit discard field cannot
wrap. A queued keyframe beyond the snap window ends scanning immediately when
audio is available, preserving all packets for exact-target native-1x preroll.

A fresh stream-origin session configures its initial speed while natively paused:
feed decoder initialization, wait for native Load completion, then apply the
requested rate in place before first Play. This avoids playing at 1x and then
changing an already-running pipeline. The startup case uses the same in-place
path as later changes; there is no timeout that forces the initial rate.
