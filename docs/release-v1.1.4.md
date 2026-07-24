# v1.1.4

This release adds optional automatic account selection on startup and improves
the removal of sponsored suggestions from the YouTube TV home feed.

## Added

- Auto Login can be enabled or disabled from the settings opened with the
  green remote-control button.
- When enabled, the app automatically selects the previously used identity on
  YouTube's account selector.
- YouTube's recurring account-selection prompt is suppressed while Auto Login
  is enabled and restored when it is disabled.

## Fixed

- Sponsored in-feed renderers that are not removed by the response filter are
  hidden by an ad-blocking stylesheet.
- On older Cobalt versions, the enclosing feed tile is also removed so that no
  empty space or invisible focus target remains.
- The compatibility fallback reacts only to newly inserted ad slots and does
  not continuously poll the page.

The release was tested on an LG webOS TV.

Install `youtube.leanback.v4_1.1.4_arm.ipk` directly or use the custom Homebrew
Channel repository listed in the README.
