#!/usr/bin/env python3
"""Device test for the 1.75x seek that restarts on a distant video keyframe.

Requires a rooted webOS TV running the shared Starfish A/V backend in a Devel
build (the `[YTAF rate ...]` diagnostics are compiled out of Gold/QA builds).
Set YTAF_TV_CONTROL to the directory containing tv_control.py. Exits 77 when
the TV is unreachable so CI and offline checkouts can skip it.

The bug this covers: at 1.75x, a seek whose demuxer restart keyframe is seconds
before the target made the native session present exactly one frame and then
stall for 20 s, after which YouTube reverted playback to 1x. The fix retargets
the seek to the next keyframe, so the checks below are the failure mode:

  1. seek-retarget logged with snapped=1 and a start inside the seek tolerance,
  2. video first-input and load for that generation,
  3. more than one presented native frame after the seek,
  4. no "stalled for 20 seconds" and no rate reset.
"""
import argparse
import importlib
import re
import sys
import time

APP_ID = "youtube.leanback.v4"
COBALT_LOG = "/tmp/cobalt-starterless.log"
RATE_LOG = "/var/log/legacy-log"
STALL = "presentation stalled for 20 seconds"


def load_tv_control(path):
    sys.path.insert(0, path)
    return importlib.import_module("tv_control")


def fail(message):
    print("FAIL: " + message)
    return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tv-control", default="C:/Tools/slopbro/tv-home-redesign")
    parser.add_argument("--label", default="far-keyframe")
    parser.add_argument("--settle", type=float, default=30.0,
                        help="seconds to observe after the seek")
    parser.add_argument("--seek-presses", type=int, default=2,
                        help="right presses inside the seek bar")
    args = parser.parse_args()

    try:
        tv = load_tv_control(args.tv_control)
        tv.run("true")
    except Exception as error:  # noqa: BLE001 - any failure means "no TV here"
        print("SKIP: TV control unavailable: %s" % error)
        return 77

    def key(name):
        return tv.luna("luna://com.webos.service.networkinput/sendSpecialKey",
                       {"key": name})

    def cobalt():
        return tv.run("cat " + COBALT_LOG).decode(errors="replace")

    def rates():
        try:
            return tv.run('grep -a "set playrate" ' + RATE_LOG).decode(
                errors="replace")
        except Exception:  # noqa: BLE001 - rotating legacy log may be absent
            return ""

    def last_rate():
        found = re.findall(r"set playrate:(\d+)", rates())
        return int(found[-1]) if found else None

    def show_controls():
        key("UP")            # controls, play button focused
        time.sleep(0.9)

    def set_speed_175():
        # Remote path on this app: UP, then right along the button row to
        # Settings, Settings > Speed > 1.75x.
        show_controls()
        for _ in range(10):
            key("RIGHT")
            time.sleep(0.2)
        key("ENTER")
        time.sleep(1.2)
        for _ in range(3):
            key("DOWN")
            time.sleep(0.3)
        key("ENTER")         # Speed
        time.sleep(1.2)
        for _ in range(3):
            key("DOWN")
            time.sleep(0.3)
        key("ENTER")         # 1.75x
        time.sleep(1.2)
        key("BACK")
        time.sleep(0.8)
        key("ENTER")         # leave the settings overlay, resume playback
        time.sleep(1.0)
        key("ENTER")
        time.sleep(2.0)

    def seek_forward(presses):
        show_controls()
        key("UP")            # seek bar
        time.sleep(0.7)
        for _ in range(presses):
            key("RIGHT")
            time.sleep(0.7)
        key("ENTER")
        time.sleep(0.5)

    print("=== %s ===" % args.label, flush=True)
    tv.run("pkill -9 -x cobalt; sleep 2")
    # The log survives app restarts, so measure from this launch only. A stale
    # line from an earlier run must never satisfy an assertion here.
    launched_at = len(cobalt())
    log = lambda: cobalt()[launched_at:]
    tv.luna("luna://com.webos.applicationManager/launch", {"id": APP_ID})
    time.sleep(8)
    key("ENTER")  # wake and start the focused video
    time.sleep(2)
    key("ENTER")

    deadline = time.time() + 30
    while time.time() < deadline:
        if "first-frame generation" in log():
            break
        time.sleep(0.5)
    else:
        return fail("playback did not start")

    at_speed = lambda: re.search(r"applied=1\.75", log()) is not None
    for _ in range(3):
        if at_speed():
            break
        set_speed_175()
        time.sleep(2.0)
    if not at_speed():
        return fail("could not reach 1.75x (last: %s)"
                    % (rates().splitlines()[-1] if rates() else "none"))
    print("at 1.75x", flush=True)

    before = log()
    generation_before = max(
        (int(value) for value in re.findall(r"generation=(\d+)", before)),
        default=0,
    )
    seek_start = len(before)
    seek_forward(args.seek_presses)

    deadline = time.time() + 10
    while time.time() < deadline:
        if "load generation=%d" % (generation_before + 1) in log()[seek_start:]:
            break
        time.sleep(0.5)
    else:
        key("ENTER")
        time.sleep(4)

    time.sleep(args.settle)
    after = log()[seek_start:]
    print("--- seek trace ---", flush=True)
    for line in after.splitlines():
        if "[YTAF" in line or STALL in line:
            print(line, flush=True)
    tv.capture("tv-seek-%s.png" % args.label)

    if STALL in after:
        return fail("native session stalled for 20 seconds after the seek")

    retarget = re.findall(
        r"seek-retarget generation=(\d+) snapped=(\d+) target_us=(-?\d+) "
        r"keyframe_us=(-?\d+) start_us=(-?\d+) skipped_video=(\d+) "
        r"skipped_audio=(\d+) given_up=(\d+)", after)
    if not retarget:
        return fail("no seek-retarget line: the seek was not retargeted")
    generation, snapped, target, keyframe, start, skipped_video, _, given_up = retarget[-1]
    generation, snapped = int(generation), int(snapped)
    target, keyframe, start = int(target), int(keyframe), int(start)
    if int(given_up):
        return fail("retarget gave up for generation %d" % generation)
    if not snapped:
        return fail("generation %d kept the distant keyframe" % generation)
    if not 0 <= start - target <= 1000000:
        return fail("snapped start %d is %+d us from the target %d"
                    % (start, start - target, target))
    if not -1000000 <= keyframe - target <= 5000000:
        return fail("chosen keyframe %d is %+d us from the target %d"
                    % (keyframe, keyframe - target, target))
    print("retarget: target=%d keyframe=%d start=%d skipped_video=%s us_off_target=%+d"
          % (target, keyframe, start, skipped_video, start - target), flush=True)

    first_input = re.search(
        r"first-input generation=%d stream=video pts_us=(-?\d+)" % generation, after)
    if not first_input:
        return fail("no video first-input for generation %d" % generation)
    demuxer_keyframe = int(first_input.group(1))
    if target - demuxer_keyframe <= 1000000:
        return fail("demuxer keyframe %d was already near the target %d: "
                    "this run did not exercise the far-keyframe case"
                    % (demuxer_keyframe, target))
    if not re.search(r"load generation=%d " % generation, after):
        return fail("no native Load for generation %d" % generation)

    frames = [int(value) for value in re.findall(
        r"seek-progress generation=%d frames=(\d+)" % generation, after)]
    if not frames or max(frames) < 2:
        return fail("only %s native frames after the seek"
                    % (max(frames) if frames else "0"))
    print("frames after seek: %s" % max(frames), flush=True)

    if last_rate() != 1750:
        return fail("playback rate reset to %s" % last_rate())
    print("PASS: far-keyframe seek at 1.75x recovered and kept its rate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
