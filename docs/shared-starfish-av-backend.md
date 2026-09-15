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
