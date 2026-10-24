# webOS DIAL and launch targets

The native entry point discarded JSON launch parameters, and SDL relaunch
notifications raised the window without forwarding their parameters. A phone
could open YouTube while its selected video never started.

`WebosLaunchUrl` accepts initial parameters and lifecycle relaunch payloads,
including nested parameter objects or JSON strings. It maps:

- DIAL video targets to `https://www.youtube.com/watch?...`;
- pairing codes and query targets to the TV URL;
- LG search/play voice intents to the corresponding YouTube TV deep link.

Only YouTube hosts are accepted for explicit URLs; malformed, oversized and
newline-containing targets are rejected. Pairing/list/time parameters are kept.
Initial targets use `--link`, preserving the normal TV entry page. SDL sends
relaunch parameters in an owned user event, consumed by `ApplicationSdl::Link`.
SDL's lifecycle log records the notification without its full payload.

`appinfo.json` registers YouTube's DIAL name and LG query/voice routing. webOS
continues to own DIAL discovery; the change does not add another DIAL server.

## Validation

Run `bash scripts/test-webos-launch-parameters.sh` with g++, pkg-config and
json-c development headers. Eleven host cases cover video, pairing, query and
already-recognized LG voice intents, nested parameters and rejected URLs.
CI checks the SDL patch against the pinned webOS SDL source and verifies its
reverse application. This does not implement raw microphone capture.

Phone casting was confirmed on an LG 55NANO85SPA, with YouTube both open
(DIAL HTTP 200) and closed (201), using a full v2.0.6-beta-based build
containing these changes and the separate microphone backend. This
current-main port's launch sources were cross-compiled with the webOS SDK;
a full current-main build/device run has not been repeated. Other TVs and
firmware launch payloads still need validation.
