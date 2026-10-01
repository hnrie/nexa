#!/usr/bin/env python3
"""Drives Safari in an iOS simulator: real touches, the real on-screen keyboard, and JavaScript in the page.

Playwright's phone sizes are Chromium in a small window. They have no iOS
keyboard, and none of what Safari does around one (the visual viewport, the
page sliding up to a focused field). This is for the things that only show on
an iPhone or an iPad. Setup is in tools/README.md.

  ios_sim.py up [--device "iPhone 17"] [--os 27]   boot a simulator, start the driver and the page inspector
  ios_sim.py open URL                              open a page in Safari (the throwaway server: http://127.0.0.1:<port>/...)
  ios_sim.py tap X Y                               a finger at a point of the screen
  ios_sim.py tapsel SELECTOR [N]                   a finger on the Nth element matching a CSS selector
  ios_sim.py press X Y [SECONDS]                   a long press
  ios_sim.py drag X Y X2 Y2 [SPEED]
  ios_sim.py keys TEXT                             typed on the on-screen keyboard, key by key
  ios_sim.py key NAME                              one key by its name (Return, delete, space, Next)
  ios_sim.py button NAME                           anything the system draws: Safari's bars, a Home Screen icon
  ios_sim.py keyboard                              whether the keyboard is up, and where
  ios_sim.py tree                                  what is on the screen, as the system sees it
  ios_sim.py home | rotate portrait|landscape | app BUNDLE-ID
  ios_sim.py eval JS [--match URL-PART] [--app NAME]  run JavaScript in the page (a promise is awaited), print the JSON
  ios_sim.py pages                                 the pages that can be inspected, and the app each is in
  ios_sim.py shot FILE.png
  ios_sim.py record FILE.mov SECONDS               a screen recording
  ios_sim.py frames FILE.mov OUT.png START STEP COUNT [PER-ROW] [SCALE]   frames of a recording side by side, to see how something moves
  ios_sim.py down                                  stop the driver and the inspector, shut the simulator down

Several simulators can be up at once: --sim NAME-OR-UDID before the command picks one, the last `up` being the default.
Screen points are the simulator's own (an iPhone 17 is 402 x 874). A page in Safari starts below Safari's top bar:
`tapsel` works that out, and prints it as `webtop`.

`eval` and `tapsel` talk to the page in Safari. A site added to the Home Screen runs in an app of its own:
open it with `button NAME` from the Home Screen, and reach its page with `--app SafariViewService`.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# what is built: the driver's project and its products
OUT = ROOT / "out" / "ios"
# What each simulator that is up is using. The driver runs inside the
# simulator and reads its commands from here, and macOS will not let a
# simulator's processes into Documents (it stops them to ask), so this is kept
# out of the repository's folder.
STATE = Path("/tmp/nexa-ios-sim")
DRIVER = ROOT / "ios" / "driver"
BREW = "/opt/homebrew/bin"


def run(*cmd: str, check: bool = True, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(list(cmd), check=check, text=True, capture_output=True, **kw)


def tool(name: str) -> str:
    found = shutil.which(name) or (f"{BREW}/{name}" if Path(f"{BREW}/{name}").exists() else None)
    if not found:
        sys.exit(f"{name} is not installed (see tools/README.md)")
    return found


# --- which simulator -------------------------------------------------------


def devices() -> list[dict]:
    listed = json.loads(run("xcrun", "simctl", "list", "devices", "available", "-j").stdout)["devices"]
    return [dict(d, runtime=runtime) for runtime, ds in listed.items() for d in ds]


def state_of(udid: str) -> Path:
    return STATE / udid


def current(explicit: str | None) -> dict:
    """The simulator a command is for: the one named, or the last one brought up."""
    known = [json.loads(p.read_text()) for p in sorted(STATE.glob("*/sim.json"), key=lambda p: p.stat().st_mtime)]
    if explicit:
        for sim in known:
            if explicit in (sim["udid"], sim["name"]):
                return sim
        sys.exit(f"no simulator called {explicit} is up")
    if not known:
        sys.exit("no simulator is up: run `tools/ios_sim.py up` first")
    return known[-1]


# --- the driver ------------------------------------------------------------


def send(sim: dict, cmd: dict, timeout: float = 90) -> dict:
    """Hands the driver one command through its queue folder and waits for the answer."""
    queue = state_of(sim["udid"]) / "queue"
    counter = queue / "n"
    n = int(counter.read_text()) if counter.exists() else 0
    tmp = queue / f"cmd-{n}.tmp"
    tmp.write_text(json.dumps(cmd))
    tmp.rename(queue / f"cmd-{n}.json")
    counter.write_text(str(n + 1))
    answer = queue / f"res-{n}.json"
    end = time.time() + timeout
    while time.time() < end:
        if answer.exists():
            return json.loads(answer.read_text())
        time.sleep(0.02)
    return {"ok": False, "error": "the driver did not answer (see driver.log)"}


def keys(sim: dict, text: str) -> dict:
    """Types on the on-screen keyboard. It shows capitals at the start of a sentence, so a letter is looked for both ways."""
    missing = []
    for ch in text:
        names = ["space"] if ch == " " else ["Return"] if ch == "\n" else [ch, ch.upper(), ch.lower()]
        if not any(send(sim, {"op": "key", "name": name}).get("ok") for name in names):
            missing.append(ch)
    return {"ok": not missing, "missing": missing}


# --- the page --------------------------------------------------------------


def pages(sim: dict) -> list[dict]:
    """The pages that can be inspected, each with the name of the app it is in (Safari, or the one a Home Screen app runs in)."""
    with urllib.request.urlopen(f"http://127.0.0.1:{sim['port'] + 1}/json", timeout=5) as r:
        found = json.load(r)
    for page in found:
        pid = page.get("appId", "").replace("PID:", "")
        page["app"] = Path(run("ps", "-ww", "-p", pid, "-o", "comm=", check=False).stdout.strip()).name if pid else ""
    return found


def evaluate(sim: dict, source: str, match: str | None = None, app: str | None = None):
    """Runs JavaScript in a page of the simulator, over the WebKit inspector protocol."""
    import websocket  # websocket-client, from tools/requirements.txt

    found = [p for p in pages(sim) if (app or "MobileSafari").lower() in p["app"].lower()]
    if match:
        found = [p for p in found if match in p["url"]] or found
    if not found:
        sys.exit("no page to inspect: is " + (app or "Safari") + " showing one?")
    ws = websocket.create_connection(found[0]["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
    try:
        # a page is reached through its target, which the inspector names first
        target = None
        ws.settimeout(1.5)
        try:
            while target is None:
                m = json.loads(ws.recv())
                if m.get("method") == "Target.targetCreated":
                    target = m["params"]["targetInfo"]["targetId"]
        except Exception:
            pass
        ws.settimeout(20)
        inner = {"id": 1, "method": "Runtime.evaluate", "params": {"expression": source, "returnByValue": True, "awaitPromise": True}}
        ws.send(json.dumps({"id": 2, "method": "Target.sendMessageToTarget", "params": {"targetId": target, "message": json.dumps(inner)}} if target else inner))
        end = time.time() + 20
        while time.time() < end:
            m = json.loads(ws.recv())
            if m.get("method") == "Target.dispatchMessageFromTarget":
                m = json.loads(m["params"]["message"])
            if m.get("id") == 1 and ("result" in m or "error" in m):
                if "error" in m:
                    return {"error": m["error"]}
                result = m["result"]
                if result.get("wasThrown"):
                    return {"thrown": result["result"].get("description")}
                return result["result"].get("value")
        return {"error": "no answer from the page"}
    finally:
        ws.close()


WHERE = """(() => {
  const sel = %s, n = %d;
  const all = [...document.querySelectorAll(sel)].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
  const e = all[n];
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), count: all.length };
})()"""

# A tap at a known place tells where the page starts on the screen: the page hears it in its own coordinates.
CALIBRATE = """new Promise((done) => {
  const hear = (e) => { document.removeEventListener('pointerdown', hear, true); done([Math.round(e.clientX), Math.round(e.clientY)]); };
  document.addEventListener('pointerdown', hear, true);
  setTimeout(() => { document.removeEventListener('pointerdown', hear, true); done(null); }, 4000);
})"""


def webtop(sim: dict, match: str | None, app: str | None) -> int:
    """How far below the top of the screen the page starts (Safari's top bar, or the status bar of a Home Screen app)."""
    cached = state_of(sim["udid"]) / f"webtop-{app or 'safari'}"
    if cached.exists():
        return int(cached.read_text())
    size = evaluate(sim, "[innerWidth, innerHeight]", match, app)
    probe = (size[0] // 2, 260)
    import threading

    heard: list = []
    listener = threading.Thread(target=lambda: heard.append(evaluate(sim, CALIBRATE, match, app)))
    listener.start()
    time.sleep(0.6)
    send(sim, {"op": "tap", "x": probe[0], "y": probe[1]})
    listener.join()
    top = probe[1] - heard[0][1] if heard and heard[0] else 62
    cached.write_text(str(top))
    return top


# --- up and down -----------------------------------------------------------


def up(device: str, os_version: str | None) -> None:
    xcodegen, proxy = tool("xcodegen"), tool("ios_webkit_debug_proxy")
    other = f"{device} (iOS {os_version})"
    wanted = [d for d in devices() if d["name"] in (device, other) and (not os_version or f"iOS-{os_version}" in d["runtime"])]
    if not wanted and os_version:
        # Xcode makes its simulators on the newest iOS only: one on an older iOS is made here, under a name that says so
        runtimes = json.loads(run("xcrun", "simctl", "list", "runtimes", "-j").stdout)["runtimes"]
        runtime = next((r["identifier"] for r in runtimes if r.get("isAvailable") and f"iOS-{os_version}" in r["identifier"]), None)
        if not runtime:
            sys.exit(f"no iOS {os_version} simulator runtime is installed (xcodebuild -downloadPlatform iOS -buildVersion {os_version}.0)")
        made = run("xcrun", "simctl", "create", other, device, runtime, check=False)
        if made.returncode != 0:
            sys.exit(f"could not make {other}: {made.stderr.strip()}")
        wanted = [d for d in devices() if d["udid"] == made.stdout.strip()]
    if not wanted:
        names = sorted({f"{d['name']} ({d['runtime'].rsplit('.', 1)[-1]})" for d in devices()})
        sys.exit(f"no simulator called {device}; there are: " + ", ".join(names))
    sim = wanted[-1]
    udid = sim["udid"]
    state = state_of(udid)
    queue = state / "queue"
    if queue.exists():
        shutil.rmtree(queue)
    queue.mkdir(parents=True)
    for cached in state.glob("webtop-*"):
        cached.unlink()

    # the on-screen keyboard, not the Mac's own keys
    run("defaults", "write", "com.apple.iphonesimulator", "ConnectHardwareKeyboard", "-bool", "false", check=False)
    if sim["state"] != "Booted":
        run("xcrun", "simctl", "boot", udid, check=False)
    run("xcrun", "simctl", "bootstatus", udid, "-b")

    project = OUT / "driver"
    if not (project / "SimDriver.xcodeproj").exists():
        shutil.copytree(DRIVER, project, dirs_exist_ok=True)
        run(xcodegen, "generate", cwd=project)
    derived = str(OUT / "derived")
    destination = f"platform=iOS Simulator,id={udid}"
    built = run("xcodebuild", "build-for-testing", "-project", str(project / "SimDriver.xcodeproj"), "-scheme", "Runner", "-destination", destination, "-derivedDataPath", derived, "-quiet", check=False)
    if built.returncode != 0:
        sys.exit("the driver did not build:\n" + (built.stdout + built.stderr)[-2000:])
    with open(state / "driver.log", "w") as log:
        subprocess.Popen(
            ["xcodebuild", "test-without-building", "-project", str(project / "SimDriver.xcodeproj"), "-scheme", "Runner", "-destination", destination, "-derivedDataPath", derived, "-only-testing:Runner/Driver/testDrive"],
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env={**os.environ, "TEST_RUNNER_SIM_QUEUE": str(queue)},
        )

    # the inspector of this simulator's pages, on a port of its own
    taken = {json.loads(p.read_text())["port"] for p in STATE.glob("*/sim.json") if p.parent.name != udid}
    port = next(p for p in range(9221, 9921, 100) if p not in taken)
    socket = run("xcrun", "simctl", "getenv", udid, "RWI_LISTEN_SOCKET").stdout.strip()
    run("pkill", "-f", f"ios_webkit_debug_proxy -s unix:{socket}", check=False)
    with open(state / "inspector.log", "w") as log:
        subprocess.Popen([proxy, "-s", f"unix:{socket}", "-c", f"null:{port},:{port + 1}-{port + 99}", "-F"], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    (state / "sim.json").write_text(json.dumps({"udid": udid, "name": sim["name"], "runtime": sim["runtime"], "port": port}))
    end = time.time() + 180
    while time.time() < end and not (queue / "ready").exists():
        time.sleep(0.5)
    if not (queue / "ready").exists():
        sys.exit(f"the driver did not start (see {state / 'driver.log'})")
    print(f"{sim['name']} ({sim['runtime'].rsplit('.', 1)[-1]}) is up: {udid}")


def down(sim: dict) -> None:
    send(sim, {"op": "quit"}, timeout=5)
    socket = run("xcrun", "simctl", "getenv", sim["udid"], "RWI_LISTEN_SOCKET", check=False).stdout.strip()
    if socket:
        run("pkill", "-f", f"ios_webkit_debug_proxy -s unix:{socket}", check=False)
    run("pkill", "-f", f"test-without-building.*{sim['udid']}", check=False)
    run("xcrun", "simctl", "shutdown", sim["udid"], check=False)
    (state_of(sim["udid"]) / "sim.json").unlink(missing_ok=True)
    print(f"{sim['name']} is down")


def frames(args: list[str]) -> None:
    binary = OUT / "frames"
    source = ROOT / "ios" / "frames.swift"
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        OUT.mkdir(parents=True, exist_ok=True)
        run("swiftc", "-O", str(source), "-o", str(binary))
    print(run(str(binary), *args).stdout.strip())


def option(args: list[str], name: str) -> str | None:
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i : i + 2]
        return value
    return None


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    which = option(args, "--sim")
    op, rest = args[0], args[1:]
    if op == "up":
        return up(option(rest, "--device") or "iPhone 17", option(rest, "--os"))
    if op == "frames":
        return frames(rest)
    sim = current(which)
    match, app = option(rest, "--match"), option(rest, "--app")
    num = lambda i, default=0.0: float(rest[i]) if len(rest) > i else default  # noqa: E731
    if op == "down":
        return down(sim)
    if op == "open":
        run("xcrun", "simctl", "openurl", sim["udid"], rest[0])
        send(sim, {"op": "app", "id": "com.apple.mobilesafari"})
        return
    if op == "shot":
        run("xcrun", "simctl", "io", sim["udid"], "screenshot", rest[0])
        return print(rest[0])
    if op == "record":
        recording = subprocess.Popen(["xcrun", "simctl", "io", sim["udid"], "recordVideo", "--codec=h264", "--force", rest[0]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(num(1, 3.0))
        recording.send_signal(2)
        recording.wait()
        return print(rest[0])
    if op == "pages":
        return print(json.dumps([{"title": p["title"], "url": p["url"], "app": p["app"]} for p in pages(sim)], indent=1))
    if op == "eval":
        return print(json.dumps(evaluate(sim, rest[0] if rest[0] != "-" else sys.stdin.read(), match, app), indent=1, ensure_ascii=False))
    if op == "tapsel":
        at = evaluate(sim, WHERE % (json.dumps(rest[0]), int(num(1))), match, app)
        if not at:
            sys.exit(f"nothing on the page matches {rest[0]}")
        top = webtop(sim, match, app)
        send(sim, {"op": "tap", "x": at["x"], "y": at["y"] + top})
        return print(json.dumps({"x": at["x"], "y": at["y"] + top, "webtop": top, "matches": at["count"]}))
    if op == "tap":
        answer = send(sim, {"op": "tap", "x": num(0), "y": num(1)})
    elif op == "press":
        answer = send(sim, {"op": "press", "x": num(0), "y": num(1), "d": num(2, 0.8)})
    elif op == "drag":
        answer = send(sim, {"op": "drag", "x": num(0), "y": num(1), "x2": num(2), "y2": num(3), "v": num(4, 600)})
    elif op == "keys":
        answer = keys(sim, rest[0])
    elif op in ("key", "button"):
        answer = send(sim, {"op": op, "name": rest[0]})
    elif op == "app":
        answer = send(sim, {"op": "app", "id": rest[0]})
    elif op == "rotate":
        for cached in state_of(sim["udid"]).glob("webtop-*"):
            cached.unlink()
        answer = send(sim, {"op": "rotate", "to": rest[0]})
    elif op in ("keyboard", "tree", "home"):
        answer = send(sim, {"op": op})
    else:
        sys.exit(f"unknown command {op} (see --help)")
    print(answer.pop("tree") if "tree" in answer else json.dumps(answer))
    if not answer.get("ok", True):
        sys.exit(1)


if __name__ == "__main__":
    main()
