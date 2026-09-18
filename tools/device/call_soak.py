#!/usr/bin/env python3
"""A call test that tries to break the app the way a phone does.

"Does it join" is not the question: that passed while 1.0.2 was crashing for
everyone who tried a call. This joins, stays, and then does what a phone does
to a call: loses the network and gets it back, goes to the home screen and
comes back, rotates, turns the camera on and off, shares its screen, leaves
and rejoins. After each step it asks whether the process is still the same one
and whether media is still moving, in both directions:

  phone sealed   frames the phone encrypted and sent (its call screen shows it)
  phone opened   frames from the browser the phone could decrypt
  peer audio_in  packets from the phone reaching the browser (call_peer.py)
  peer opened    frames from the phone the browser could decrypt

A call that is up but silent in one direction fails here.

  tools/device/call_soak.py [--rounds 3] [--package xyz.evilion.chat] [--no-share]

Expects an emulator on adb with the app signed in as bob and sitting in the
server seed.py made, and call_peer.py running with alice already in the call.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ui import adb, nodes  # noqa: E402

failures: list[str] = []
PEER = Path("/tmp/nexa-device/peer.json")


def pid(pkg: str) -> str:
    return adb("shell", "pidof", pkg).strip()


def find(ns: list[dict], text: str | None = None, desc: str | None = None, exact: bool = False) -> dict | None:
    for n in ns:
        if text is not None:
            t = n.get("text", "")
            if (t == text) if exact else (text in t):
                return n
        if desc is not None:
            d = n.get("content-desc", "")
            if (d == desc) if exact else (desc in d):
                return n
    return None


def tap(n: dict) -> None:
    adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))


def allow_prompts(ns: list[dict]) -> bool:
    """Answers a runtime permission prompt if one is up."""
    for label in ("While using the app", "Only this time", "Allow"):
        n = find(ns, text=label, exact=True)
        if n:
            tap(n)
            time.sleep(2)
            return True
    return False


def phone_frames(ns: list[dict]) -> tuple[int, int, int] | None:
    for n in ns:
        m = re.search(r"([\d,.\s]+) sealed · ([\d,.\s]+) opened(?: · ([\d,.\s]+) dropped)?", n.get("text", ""))
        if m:
            num = lambda s: int(re.sub(r"\D", "", s or "0") or 0)  # noqa: E731
            return num(m.group(1)), num(m.group(2)), num(m.group(3))
    return None


def peer() -> dict:
    try:
        s = json.loads(PEER.read_text())
    except (OSError, ValueError):
        return {}
    return s if time.time() - s.get("t", 0) < 10 else {}


def grew(before: int, after: int) -> int:
    """How much a counter moved. One that went down started again from zero:
    the browser's packet count is per connection, and the connection can be
    replaced in the middle of a measurement."""
    return after - before if after >= before else after


def moving(label: str, seconds: int = 20) -> bool:
    """Whether media flows both ways over the next few seconds."""
    first_phone = phone_frames(nodes())
    first_peer = peer()
    time.sleep(seconds)
    ns = nodes()
    last_phone = phone_frames(ns)
    last_peer = peer()
    ok = True
    if not first_phone or not last_phone:
        failures.append(f"{label}: the call screen shows no frame counts")
        print(f"    ✗ no frame counts on the call screen")
        return False
    ds, do = grew(first_phone[0], last_phone[0]), grew(first_phone[1], last_phone[1])
    pa = grew(first_peer.get("audio_in", 0), last_peer.get("audio_in", 0)) if first_peer and last_peer else None
    po = grew(first_peer.get("opened", 0), last_peer.get("opened", 0)) if first_peer and last_peer else None
    print(f"    over {seconds}s: phone sealed +{ds}, opened +{do}; peer audio_in +{pa}, opened +{po}")
    if ds <= 0:
        failures.append(f"{label}: the phone stopped sending")
        ok = False
    if do <= 0:
        failures.append(f"{label}: the phone hears nothing from the browser")
        ok = False
    if pa is None:
        failures.append(f"{label}: call_peer.py is not reporting")
        ok = False
    elif (po or 0) <= 0:
        # frames the browser decrypted are the proof; its packet count is per
        # connection and reads zero for a moment whenever that is replaced
        failures.append(f"{label}: the browser hears nothing from the phone (packets +{pa}, opened +{po})")
        ok = False
    return ok


def same(label: str, pkg: str, start: str) -> bool:
    now = pid(pkg)
    if not now:
        failures.append(f"{label}: the app died")
        print(f"  ✗ {label}: DEAD")
        return False
    if now != start:
        failures.append(f"{label}: the process restarted ({start} → {now})")
        print(f"  ✗ {label}: restarted {start} → {now}")
        return False
    print(f"  ✓ {label}")
    return True


def in_call(ns: list[dict]) -> bool:
    return find(ns, desc="Leave", exact=True) is not None


def join(voice: str) -> bool:
    for _ in range(4):
        ns = nodes()
        if in_call(ns):
            return True
        if allow_prompts(ns):
            continue
        row = find(ns, text=voice, exact=True)
        if row is None:
            menu = find(ns, desc="Channels", exact=True)
            if menu:
                tap(menu)
            else:
                adb("shell", "input", "swipe", "5", "1200", "700", "1200", "200")
            time.sleep(2)
            continue
        tap(row)
        time.sleep(4)
    for _ in range(15):
        ns = nodes()
        if allow_prompts(ns):
            continue
        if in_call(ns) and phone_frames(ns):
            return True
        time.sleep(2)
    return in_call(nodes())


def press(desc: str) -> bool:
    n = find(nodes(), desc=desc, exact=True)
    if not n:
        print(f"    (no button {desc!r} on screen)")
        return False
    tap(n)
    return True


def share_screen() -> bool:
    """Starts a share of the whole screen, through Android's own consent dialog.

    Android 14 and up open it on "Share one app", whose button is Next and
    leads to an app picker; the whole screen is the other entry of the
    dropdown, and its button is "Share screen". Older versions have one
    button, "Start now".
    """
    if not press("Share screen"):
        return False
    time.sleep(3)
    for _ in range(8):
        ns = nodes()
        if find(ns, desc="Stop sharing", exact=True):
            return True
        # buttons are text; the call screen's own "Share screen" is a description
        button = find(ns, text="Share screen", exact=True) or find(ns, text="Start now", exact=True)
        whole = find(ns, text="Share entire screen", exact=True) or find(ns, text="Entire screen", exact=True)
        spinner = find(ns, text="Share one app", exact=True) or find(ns, text="A single app", exact=True)
        if button and (whole or not spinner):
            tap(button)          # the whole screen is chosen, or there is no choice
            time.sleep(5)
        elif whole:
            tap(whole)           # the dropdown is open
            time.sleep(2)
        elif spinner:
            tap(spinner)         # open the dropdown
            time.sleep(2)
        else:
            time.sleep(2)
    return find(nodes(), desc="Stop sharing", exact=True) is not None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--package", default="xyz.evilion.chat")
    ap.add_argument("--voice", default="General", help="the voice channel's name as the phone shows it")
    ap.add_argument("--no-share", action="store_true")
    args = ap.parse_args()
    pkg = args.package

    adb("logcat", "-c")
    start = pid(pkg)
    print("app pid", start or "(not running)")
    if not start:
        print("start the app first")
        return 2

    for round_no in range(1, args.rounds + 1):
        print(f"\n=== round {round_no} ===")
        if not join(args.voice):
            failures.append(f"round {round_no}: could not get into the call")
            print("  ✗ could not get into the call")
            break
        if not same("join", pkg, start):
            break
        moving(f"round {round_no} after join")

        # Wi-Fi to mobile, as far as the app can tell: everything goes, then comes back
        adb("shell", "svc", "wifi", "disable")
        adb("shell", "svc", "data", "disable")
        time.sleep(12)
        adb("shell", "svc", "wifi", "enable")
        adb("shell", "svc", "data", "enable")
        time.sleep(25)
        if not same("network lost and back", pkg, start):
            break
        moving(f"round {round_no} after the network came back")

        adb("shell", "input", "keyevent", "3")
        time.sleep(10)
        # Brought back the way a person does, from the launcher; the call keeps its screen
        adb("shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
        time.sleep(6)
        if not same("home and back", pkg, start):
            break
        if not in_call(nodes()):
            # the call screen is a dialog over the chat; the call bar or the channel brings it back
            join(args.voice)
        moving(f"round {round_no} after coming back")

        adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
        adb("shell", "settings", "put", "system", "user_rotation", "1")
        time.sleep(6)
        adb("shell", "settings", "put", "system", "user_rotation", "0")
        time.sleep(6)
        if not same("rotated and back", pkg, start):
            break

        if press("Turn on camera"):
            time.sleep(3)
            allow_prompts(nodes())
            time.sleep(8)
            if not same("camera on", pkg, start):
                break
            before = peer().get("video_frames", 0)
            time.sleep(6)
            after = peer().get("video_frames", 0)
            print(f"    peer decoded {after - before} video frames in 6s")
            if after <= before:
                failures.append(f"round {round_no}: the camera is on and the browser sees nothing")
            press("Turn off camera")
            time.sleep(4)
            if not same("camera off", pkg, start):
                break

        if not args.no_share:
            shared = share_screen()
            if not same("screen share started", pkg, start):
                break
            if shared:
                time.sleep(8)
                press("Stop sharing")
                time.sleep(4)
                if not same("screen share stopped", pkg, start):
                    break
            else:
                failures.append(f"round {round_no}: the screen share never started")
                print("    ✗ the screen share never started")
                adb("shell", "input", "keyevent", "4")
                time.sleep(2)

        moving(f"round {round_no} before leaving")
        press("Leave")
        time.sleep(6)
        if not same("leave", pkg, start):
            break

    adb("shell", "settings", "put", "system", "accelerometer_rotation", "1")
    print("\n=== crashes in logcat ===")
    log = adb("logcat", "-d")
    for pattern in ("FATAL EXCEPTION", "SIGSEGV", "SIGABRT", "java_class == null", "ANR in", "Fatal signal"):
        n = log.count(pattern)
        print(f"  {pattern}: {n}")
        if n:
            failures.append(f"{pattern} appeared {n} times")
    out = Path("/tmp/nexa-device/call_soak.log")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(log[-800000:])
    print("  logcat kept at", out)

    print("\n=== verdict ===")
    if failures:
        for f in failures:
            print("  FAIL", f)
        return 1
    print("  every round clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
