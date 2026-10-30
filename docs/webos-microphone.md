# webOS microphone capture

The inherited Linux port uses stub `SbMicrophone` functions. YouTube cannot
record audio through MediaRecorder until these functions expose a real input.

`LgVoiceCapture` requests `com.webos.service.voiceconductor/recordVoice` with
`subscribe: true` and `socketType: "socket"`. The returned `websocket` field is
an AF_UNIX stream path containing mono signed 16-bit PCM at 16 kHz. The seven
Starboard microphone functions expose this input to Cobalt's MediaRecorder
implementation. No speech-service API key is needed for this route.

On TVs where `recordVoice` fails with error 300 (observed on the C1), the
backend falls back to `com.webos.service.voiceinput`: it reads `getDevices`,
selects the first `remote` device, and calls `startStreaming` with
`deviceId`, `deviceType: "remote"`, `keyType: "thinQtv"` and
`subscribe: true`. The returned `websocket` is used exactly like the
voiceconductor path; stop maps to `voiceinput/stopStreaming`. The fallback is
only selected after the 300 error, so unaffected TVs keep the original route.

The backend borrows the existing app-named LS2 connection from
`libhelpers.so.2`, already used by SDL. It checks the exported
`HLunaServiceBridge::instance()` and `PrivateHandle()` entry points and the
connection's GLib context before use. Missing helper support fails capture
without registering an alternative service or requesting elevated roles.

LS2 operations and cancellation run on that connection's dispatcher. Replies
are copied to the capture worker's private context. Closing the microphone
stops its recording ticket, cancels both calls and drains callbacks before
destroying state; the app's shared connection remains registered. This also
handles a ticket arriving after close has been requested and a delayed stop
reply. The buffer is bounded, preserves unread samples, discards incoming
overflow in complete samples and is cleared on close. Sessions are limited to
30 seconds. The backend writes no audio files and does not log recording
tickets or socket paths.

Wake/connect the Magic Remote before capture. A disconnected remote can return
`6020: failed to open voice stream`; this is reported as a microphone error.

## Validation

Run `bash scripts/test-webos-microphone.sh` with g++, pkg-config, GLib and
json-c development headers. Tests use synthetic PCM, a local UNIX socket and a
mocked shared LS2 dispatcher. They cover helper ABI/lifetime, unavailable
handles, sample alignment, overflow, reopen, shutdown, service errors, delayed
tickets and delayed stop replies. No TV credentials or recordings are needed.
CI also applies the complete overlay twice to clean Cobalt 23.lts.6.

In-app voice search was confirmed on an LG 55NANO85SPA using a full
v2.0.6-beta-based build containing this backend and the separate launch fix.
This current-main port's microphone sources were cross-compiled with the
webOS SDK; a full current-main build/device run has not been repeated.
Other TVs and helper ABIs still need validation, including the C1 in #35.
