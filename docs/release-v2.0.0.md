# YouTube Cobalt AdFree v2.0.0

First stable release of the 2.x **starterless Cobalt** line, following the 2.0.0–2.0.7 beta series.

## Highlights

- Native Cobalt runtime packaged for LG webOS without the old Cobalt starter binary.
- YouTube ad filtering, SponsorBlock, Return YouTube Dislike and configurable Shorts visibility.
- LG Magic Remote scroll wheel integration and webOS system font support.
- Improvements to webOS DIAL/launch handling and microphone integration.
- Bundled AAC decoder for livestream playback.
- webOS 4 compatibility work (ACB video path, AV1 gating, libatomic and locale handling).
- Homebrew Channel updates automatically from validated stable release asset metadata.

## Installation and upgrade

Download `youtube.leanback.v4_2.0.0_arm.ipk` from the **v2.0.0 GitHub release**, or use the custom Homebrew repository documented in README.md after its stable catalog entry has synchronized.

The application ID remains `youtube.leanback.v4` to preserve account and phone-pairing compatibility. Installing the package replaces the official YouTube application. **Do not install both under the same ID.**

The beta Homebrew catalog entry remains separate. Devices that already have a 2.0.7 beta package may not accept 2.0.0 as an in-place upgrade because 2.0.0 is numerically lower. Test migration separately; do not assume beta-to-stable will install without additional steps.

## Known issues and limitations

Some TV/firmware combinations still have reported startup, playback, microphone and playback-speed problems. In particular, verify the webOS 4 black-screen report against a package containing the latest webOS 4 code. Check the issue tracker before declaring platform-wide compatibility.

## Release checklist

- [ ] Merge release-preparation PR after CI passes.
- [ ] Confirm the exact Cobalt runtime build SHA and that the selected artifact contains the webOS 4 compatibility changes.
- [ ] Run **Package starterless Cobalt IPK** with `version=2.0.0` and the verified successful Cobalt build run ID.
- [ ] Verify resulting `youtube.leanback.v4_2.0.0_arm.ipk` on target LG devices, especially webOS 4, restart, network, livestream AAC, remote wheel and playback speed.
- [ ] Publish a **non-prerelease** GitHub release using tag `v2.0.0`, attach the exact tested IPK, and use this document as release notes.
- [ ] Verify the **Sync Homebrew stable manifest** workflow updated `repo.json` with the new IPK URL, SHA-256 and size; keep beta entry unchanged.
- [ ] Confirm Homebrew installation and upgrade from stable 1.2.5.

**Do not point the stable catalog at an unpublished artifact or reuse the 2.0.7 beta IPK renamed to 2.0.0.**
