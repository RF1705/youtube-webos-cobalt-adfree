# v1.1.2

This maintenance release fixes remote-control navigation in the settings menu
on affected LG webOS devices.

## Fixed

- Pressing an arrow button on the physical remote now advances the settings
  selector by one row instead of skipping every second row.
- Menu navigation keeps its own selection index so that a parallel Cobalt
  spatial-navigation update cannot be counted as a second user action.

Thanks to [LawfulGremlin](https://github.com/LawfulGremlin) for reporting the
issue, testing the behavior on an LG C1 running webOS 6.5.3, and sharing a
confirmed solution.

Install `youtube.leanback.v4_1.1.2_arm.ipk` directly or use the custom Homebrew
Channel repository listed in the README.
