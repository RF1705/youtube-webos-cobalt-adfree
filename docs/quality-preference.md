# Quality preference

The extra menu (GREEN) has a **Quality preference** choice:

| Value | Behaviour |
| --- | --- |
| Auto (default) | YouTube's own adaptive selection; the controller does nothing |
| Highest available | Pin the top offered level for each new video |
| 2160p | Pin the highest offered level at or below 2160p |
| 1440p | Pin the highest offered level at or below 1440p |
| 1080p | Pin the highest offered level at or below 1080p |

The controller only selects a level YouTube already offers. It never edits
manifests, MIME probes or native capability limits, so it cannot make a 4K
format appear for a video or codec that YouTube excluded.

## Lifecycle

- Applies once per video, after the player reports the same `video_id` as the
  page and a non-empty available-quality list.
- Uses `setPlaybackQualityRange(level, level)` when present and
  `setPlaybackQuality(level)` otherwise. If neither exists it stops trying.
- Ads are skipped implicitly: the player's `video_id` does not match the page
  id until the ad ends. Live content is left on Auto.
- Turning the choice back to Auto returns control to YouTube's adaptive
  selection; the current rung may persist until ABR moves.
- Changing the cap is debounced briefly so cycling the menu choice does not
  reload the pipeline for every intermediate value.
- If playback makes no progress shortly after pinning a level, that video is
  reverted to Auto once and not retried.

## Limits

- Availability is content-dependent: most uploads have no 1440p/4K rendition,
  and the TV client may offer a lower maximum when capability probes fail.
- Verified on the C1 with AV1 4K **SDR** (`a1mI-ozLyYM`): explicit 2160p loaded
  `codec=AV1 size=3840x2160` and presented visible frames. HDR, VP9 profile 2
  and 4K at accelerated playback speeds are not verified.
- The controller depends on the YouTube TV player's internal quality API. A
  client update that renames the methods disables the feature without breaking
  playback; the menu still works.
- Debug builds expose `window.__ytafQualityPreference.sync()` for probing.
