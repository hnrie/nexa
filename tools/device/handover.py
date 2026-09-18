#!/usr/bin/env python3
"""The network changes a phone call actually goes through, one at a time.

call_soak.py turns everything off and on at once, which is a tunnel. This is
the ordinary day: Wi-Fi goes and the call moves to mobile data, Wi-Fi comes
back and the call moves onto it — and thirty seconds later Android tears the
mobile network down, which is when every socket still on it dies. After each
change it waits long enough for that to happen, then checks that media flows
both ways.

  tools/device/handover.py [--rounds 2] [--package xyz.evilion.chat]

Same setup as call_soak.py: the app in the call, call_peer.py running.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import call_soak as soak  # noqa: E402
from ui import adb, nodes  # noqa: E402

# Android keeps a network it no longer prefers for this long before tearing
# it down (ConnectivityService's linger), plus some slack.
LINGER_S = 45


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--package", default="xyz.evilion.chat")
    ap.add_argument("--voice", default="General")
    args = ap.parse_args()
    pkg = args.package

    adb("logcat", "-c")
    adb("shell", "svc", "wifi", "enable")
    adb("shell", "svc", "data", "enable")
    start = soak.pid(pkg)
    if not start or not soak.join(args.voice):
        print("the app is not in the call")
        return 2
    soak.moving("before anything")

    for n in range(1, args.rounds + 1):
        print(f"\n=== round {n} ===")
        adb("shell", "svc", "wifi", "disable")
        print("  Wi-Fi off: onto mobile data")
        time.sleep(20)
        if not soak.same("on mobile data", pkg, start):
            break
        soak.moving(f"round {n} on mobile data", 15)

        adb("shell", "svc", "wifi", "enable")
        print(f"  Wi-Fi back: waiting {LINGER_S}s for mobile data to be let go of")
        time.sleep(LINGER_S)
        if not soak.same("back on Wi-Fi", pkg, start):
            break
        soak.moving(f"round {n} back on Wi-Fi", 15)

    log = adb("logcat", "-d")
    lines = [l for l in log.splitlines() if "SfuTransport" in l or "VoiceSession" in l]
    out = Path("/tmp/nexa-device/handover.log")
    out.write_text("\n".join(lines))
    print(f"\ncall log kept at {out} ({len(lines)} lines)")
    for pattern in ("FATAL EXCEPTION", "SIGSEGV", "SIGABRT", "ANR in"):
        if log.count(pattern):
            soak.failures.append(f"{pattern} appeared {log.count(pattern)} times")

    print("\n=== verdict ===")
    if soak.failures:
        for f in soak.failures:
            print("  FAIL", f)
        return 1
    print("  every change came back")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
