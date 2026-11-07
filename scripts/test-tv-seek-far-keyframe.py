#!/usr/bin/env python3
"""Device test for the 1.75x seek that restarts on a distant video keyframe.

Requires a rooted webOS TV running the shared Starfish A/V backend in a Devel
build (the `[YTAF rate ...]` diagnostics are compiled out of Gold/QA builds).
Set YTAF_TV_CONTROL to the directory containing tv_control.py. Exits 77 when
the TV is unreachable so CI and offline checkouts can skip it.

Checks a bounded snap or exact-target 1x preroll followed by sustained native
1.75x progress. This UI-driven smoke test does not establish binary identity,
audible output, or hardware-picture motion; verify those independently.
"""
import argparse
import importlib
import os
import re
import statistics
import sys
import time

APP_ID = "youtube.leanback.v4"
COBALT_LOG = "/tmp/cobalt-starterless.log"
STALL = "presentation stalled for 20 seconds"


def load_tv_control(path):
    if path:
        sys.path.insert(0, path)
    return importlib.import_module("tv_control")


def fail(message):
    print("FAIL: " + message)
    return 1


def skip(message):
    print("SKIP: " + message)
    return 77


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tv-control", default=os.environ.get("YTAF_TV_CONTROL"),
                        help="directory containing tv_control.py (or YTAF_TV_CONTROL)")
    parser.add_argument("--expected-codec", choices=("H264", "VP9", "AV1"),
                        help="fail unless this shared backend is actually exercised")
    parser.add_argument("--device-label", default="unspecified device/webOS",
                        help="device and webOS version recorded in the test output")
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

    print("=== %s (%s) ===" % (args.label, args.device_label), flush=True)
    for pid in tv.run("pidof cobalt || true").decode().split():
        if pid.isdigit():
            try:
                executable = tv.run("readlink /proc/" + pid + "/exe").decode()
                if APP_ID + "/cobalt" in executable:
                    tv.run("kill -TERM " + pid)
            except Exception:
                pass  # the process may already have exited
    time.sleep(2)
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

    codecs = re.findall(r"selected shared (H264|VP9|AV1)\+Opus backend", log())
    if not codecs:
        return fail("no shared-backend codec evidence")
    print("shared codec: %s" % codecs[-1], flush=True)
    if args.expected_codec and codecs[-1] != args.expected_codec:
        return fail("expected %s but playback selected %s"
                    % (args.expected_codec, codecs[-1]))

    at_speed = lambda: re.search(r"applied=1\.75", log()) is not None
    for _ in range(3):
        if at_speed():
            break
        set_speed_175()
        time.sleep(2.0)
    if not at_speed():
        return fail("no applied 1.75x evidence in this launch's native log")
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
        return fail("no native Load after the seek")

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
    if not snapped and not int(given_up):
        return skip("demuxer keyframe was already near the target: "
                    "this run did not exercise the far-keyframe case")
    if not snapped and start != target:
        return fail("far-keyframe recovery did not preserve the exact target")
    if not -1000000 <= start - target <= 1000000:
        return fail("snapped start %d is %+d us from the target %d"
                    % (start, start - target, target))
    if snapped and not -1000000 <= keyframe - target <= 900000:
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
        return skip("demuxer keyframe %d was already near the target %d: "
                    "this run did not exercise the far-keyframe case"
                    % (demuxer_keyframe, target))
    if not re.search(r"load generation=%d " % generation, after):
        return fail("no native Load for generation %d" % generation)
    load_codecs = re.findall(r"load generation=%d codec=(H264|VP9|AV1) " % generation, after)
    if len(load_codecs) != 1:
        return fail("seek did not load exactly one native session")
    load_targets = re.findall(r"load generation=%d [^\n]*target_us=(-?\d+)" % generation, after)
    if load_targets != [str(start)]:
        return fail("native Load target differs from the selected seek start")
    if args.expected_codec and load_codecs != [args.expected_codec]:
        return fail("seek did not load exactly one %s session (observed %s)"
                    % (args.expected_codec, load_codecs))

    # Early callbacks and stale firmware rate logs previously produced false
    # passes. Require sustained native progress from this seek generation.
    samples = re.findall(
        r"\[YTAF rate monotonic_us=(\d+)\] rate-progress generation=%d "
        r"requested=1\.75 applied=1\.75 current_us=(\d+) frames=(\d+)" % generation, after)
    samples = [(int(w), int(t), int(f)) for w, t, f in samples]
    if len(samples) < 10 or samples[-1][0]-samples[0][0] < 10_000_000:
        return fail("insufficient sustained native timing evidence at 1.75x")
    samples = samples[3:]  # omit the flushing transition's initial settling
    slope = statistics.linear_regression([s[0] for s in samples], [s[1] for s in samples]).slope
    if not 1.65 <= slope <= 1.85 or samples[-1][2] <= samples[0][2]:
        return fail("native progress disagrees with requested speed: %.4fx" % slope)
    if re.search(r"\[YTAF shared A/V[^\n]*error:", after):
        return fail("player reported an error during the observation")
    print("PASS: native seek progress %.4fx; hardware-picture/audio checks remain separate" % slope)
    return 0


if __name__ == "__main__":
    sys.exit(main())
