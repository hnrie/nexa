#!/usr/bin/env python3
"""Drives the Android app through uiautomator, by what is on screen.

  ui.py dump                     every labelled node, with its centre
  ui.py tap text <s>             tap the first node whose text contains <s>
  ui.py tap desc <s>             … whose content description contains <s>
  ui.py type <s>                 type into whatever has focus

Coordinates from a dump rather than hard-coded ones, because the keyboard
coming up moves everything and a blind tap then lands on the wrong control.
"""
import os, re, shutil, subprocess, sys

ADB = shutil.which("adb") or os.path.join(
    os.environ.get("ANDROID_HOME", "/usr/local/share/android-commandlinetools"), "platform-tools", "adb")


def adb(*args: str) -> str:
    return subprocess.run([ADB, *args], capture_output=True, text=True, timeout=60).stdout


def nodes() -> list[dict]:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb("shell", "cat", "/sdcard/ui.xml")
    out = []
    for m in re.finditer(r"<node ([^>]*?)/?>", xml):
        a = dict(re.findall(r'(\S+?)="([^"]*)"', m.group(1)))
        b = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", a.get("bounds", ""))
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        a["cx"], a["cy"] = (x1 + x2) // 2, (y1 + y2) // 2
        out.append(a)
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    if cmd == "dump":
        for n in nodes():
            if n.get("text") or n.get("content-desc"):
                cls = n.get("class", "").split(".")[-1]
                print(f"  ({n['cx']:4},{n['cy']:4}) {cls:16} text={n.get('text','')!r} desc={n.get('content-desc','')!r}")
        return 0
    if cmd == "tap" and len(sys.argv) >= 4:
        field = "text" if sys.argv[2] == "text" else "content-desc"
        want = " ".join(sys.argv[3:])
        for n in nodes():
            if want in n.get(field, ""):
                adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
                print(f"tapped ({n['cx']},{n['cy']}) for {want!r}")
                return 0
        print(f"nothing with {field} containing {want!r}", file=sys.stderr)
        return 1
    if cmd == "type":
        adb("shell", "input", "text", " ".join(sys.argv[2:]).replace(" ", "%s"))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
