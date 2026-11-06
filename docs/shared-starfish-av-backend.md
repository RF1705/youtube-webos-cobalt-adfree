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
- **Rate change**: exactly `1.0` is the one rate this firmware cannot apply in
  place. `StarfishMediaAPIs::SetPlayRate` parses `playRate` as a float,
  range-checks it (-128..128) and returns true, but the pipeline treats 1.0 as
  the default rate and never sets the audio decoder's `play-speed` property, so
  `lxadec_set_play_speed` is not called and playback keeps its speed.
  Fractional values do reach the decoder, downward included (1.75 -> 1.5 works),
  and the direct LS2 route is closed (a `com.webos.media/setPlayRate` on this
  unmanaged pipeline returns `returnValue: false`). Reaching exactly 1x
  therefore reloads the native session at the presented position from the
  retained GOP, which starts at 1x. That costs one vendor pipeline reload
  (~0.3 s of blank picture) per return to Normal; it is accepted over faking the
  rate with 0.999, which would leave playback 0.1 % fast for the rest of the
  video.
  A reload requires replay coverage, a presented frame, a valid Opus pre-roll
  plan, and a video keyframe within 1 s of the new start. If these are missing,
  the request stays pending while the existing session continues at its applied
  speed; the bridge retries as new packets and keyframes arrive. It never falls
  back to sending the ineffective `playRate: 1.0`, and never rewinds video without
  matching retained audio. Forward native presentation extends the wait, so a long GOP at a slow applied
  speed does not turn healthy playback into a terminal error. After 5 s without
  forward presentation, the bridge reports an explicit decode error through the
  existing player error callback. Cobalt requires player recreation after that
  terminal error; a seek alone cannot clear its error latch. The applied rate is unchanged on failure.

Other rate changes stay in the existing session and keep its exported window.
Pending reload data is published, cancelled by seeks, and consumed under the
owner mutex. Publication rechecks both the session generation and requested rate;
session creation transfers the retained packets into local storage before
releasing the mutex, so a concurrent seek cannot clear storage being moved.

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
100 ms. Audio keeps at most 100 ms of pre-roll before that keyframe, which holds
the Opus pre-skip plan inside its 80 ms–1.365 s window, and native and audio
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

All in-place rate transitions require replay coverage, at least two callbacks,
presentation at least 200 ms beyond the native target, accepted video at least
1 s ahead and audio at least 200 ms ahead. The old two-second forced transition
has been removed. While waiting,
the media-time provider reports the applied native rate, not the requested
rate; pausing reports zero. A pending transition fails explicitly only after
5 s without forward native presentation, rather than flushing unsafe input.
Fully fed tails with established presentation keep playing at the applied rate
and finish via native EOS even when the headroom can never be satisfied; the
existing 20 s stall watchdog remains active. Pausing clears the active wait;
resuming and a different rate request each get a fresh deadline. The firmware's
pause/reset behavior remains based on the C1 trace and needs other-device checks.

Disabling replay is diagnostic only: a non-default rate may be attempted before
the first feed on an empty pipeline, but post-feed changes still require safe
coverage. With replay disabled, the request remains pending while presentation
advances and fails explicitly if presentation stops for 5 s outside a fully fed tail. See
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
