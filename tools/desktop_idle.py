#!/usr/bin/env python3
"""
The desktop app's background behaviour, checked in the app itself.

Starts a throwaway chatd (E2E_CHATD and E2E_WEB_DIST name the scratch build,
as for e2e.py), seeds alice and bob, builds desktop/dist-app and runs it
through desktop_idle/main.js: muted, no tray icon, no system-wide keys, Rich
Presence off, a profile of its own. Windows are real and shown on screen.

  - throttling: hidden or minimised the page stops drawing and its timers
    slow down; a call keeps it at full speed, also across hiding, reloads and
    the call ending out of sight; a message to the sleeping page notifies and
    its sound plays on audio that had been resting
  - hidden launch: started into the tray (as at login with Start Minimized),
    the page sleeps without the window ever being opened
  - call: two headless Chromium pages call each other; the call's
    devicechange listener (which starts the browser's audio and camera
    services) is there only during the call

Every wait has a deadline and the app has one of its own, so a run ends.

  tools/.venv/bin/python tools/desktop_idle.py [--long 330]

--long keeps the page asleep that many seconds before the message (Chromium
throttles hidden pages harder after five minutes).
"""
import argparse, json, os, subprocess, sys, tempfile, time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from e2e import Server  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent / "desktop_idle"
PW = "correct horse battery staple"


def electron() -> str:
    mac = ROOT / "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    return str(mac if sys.platform == "darwin" else ROOT / "desktop/node_modules/electron/dist/electron")


def seed(base):
    out = subprocess.run([sys.executable, str(ROOT / "tools/seed.py"), base, "--no-formatting"], capture_output=True, text=True, timeout=300)
    ids = dict(line.split(" ", 1) for line in out.stdout.splitlines() if line.split(" ", 1)[0] in ("SERVER", "GENERAL", "VOICE"))
    if "SERVER" not in ids:
        sys.exit("seed failed:\n" + out.stdout + out.stderr)
    return ids["SERVER"].strip(), ids["GENERAL"].strip()


def run_app(base, server, chan, mode, profile, long_s=0):
    """One run of the app with test.js; True when every check passed."""
    settings = profile / "settings.json"
    s = json.loads(settings.read_text()) if settings.exists() else {}
    s.update(launchAtLogin=False, rpcEnabled=False, rpcRelay=False, closeToTray=True, startMinimized=mode == "hidden")
    settings.write_text(json.dumps(s))
    env = dict(os.environ, APP_MAIN=str(ROOT / "desktop/dist-app/main.js"), EVILION_URL=base, EVILION_USER_DATA=str(profile), EVILION_NO_LOGIN_ITEM="1", T_SERVER=server, T_CHAN=chan, T_MODE=mode, T_LONG=str(long_s))
    args = [electron(), str(HERE)] + (["--hidden"] if mode == "hidden" else [])
    proc = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    passed = False
    for line in proc.stdout:
        if line.startswith("[t"):
            print("  " + line.rstrip(), flush=True)
            passed = passed or "ALL PASS" in line
    proc.wait()
    return passed and proc.returncode == 0


def call_check(base, server):
    """alice and bob call each other in headless Chromium; the devicechange listener is the call's alone."""
    count = """(() => { let n = 0; const md = navigator.mediaDevices; const add = md.addEventListener.bind(md), rem = md.removeEventListener.bind(md);
      md.addEventListener = (t, f, o) => { if (t === 'devicechange') n++; return add(t, f, o); };
      md.removeEventListener = (t, f, o) => { if (t === 'devicechange') n--; return rem(t, f, o); };
      Object.defineProperty(window, '__devlisteners', { get: () => n }); })()"""
    ok = True

    def check(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'PASS' if cond else 'FAIL'} {label} {detail}", flush=True)

    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        try:
            pages = []
            for name in ("alice", "bob"):
                ctx = br.new_context(viewport={"width": 1366, "height": 768}, permissions=["microphone", "camera"])
                ctx.set_default_timeout(20000)
                ctx.add_init_script(count)
                p = ctx.new_page()
                p.goto(base + "/login", wait_until="networkidle")
                p.fill("input[autocomplete=username]", name)
                p.fill("input[type=password]", PW)
                p.click("button[type=submit]")
                p.wait_for_url("**/channels/@me", timeout=60000)
                p.goto(f"{base}/channels/{server}", wait_until="networkidle")
                try:
                    p.wait_for_selector("[data-testid=terms-gate]", timeout=6000)
                    p.check("[data-testid=terms-check]")
                    p.click("[data-testid=terms-agree]")
                    p.wait_for_selector("[data-testid=terms-gate]", state="detached", timeout=10000)
                except Exception:
                    pass
                try:
                    p.click("[data-testid=whats-new-done]", timeout=3000)
                except Exception:
                    pass
                pages.append(p)
            a, b = pages
            n = lambda: (a.evaluate("__devlisteners"), b.evaluate("__devlisteners"))
            check("no devicechange listener before a call", n() == (0, 0), n())
            for p in pages:
                p.locator("[data-channel]:has(span:text-is('General')) button").first.click()
                p.wait_for_selector("[data-testid=voice-status]")
            for p in pages:
                p.wait_for_function("() => document.querySelectorAll('[data-peer-state=connected][data-user]').length === 2", timeout=60000)
            check("both connected", True)
            check("during the call: the call's listener and the call view's", n() == (2, 2), n())
            a.click("[data-testid=voice-mute]")
            b.wait_for_selector("[data-testid=voice-participants] [data-user] svg.lucide-mic-off", timeout=15000)
            check("alice's mute shows for bob", True)
            a.click("[data-testid=voice-mute]")
            for p in pages:
                p.click("[data-testid=voice-status-leave]")
                p.wait_for_function("() => !document.querySelector('[data-testid=voice-status]')")
            time.sleep(0.5)
            check("after leaving: only the call view's, still open", n() == (1, 1), n())
        except Exception as e:
            check("the call", False, str(e).splitlines()[0])
        finally:
            br.close()
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--long", type=int, default=0, help="seconds asleep in the tray before the message")
    ap.add_argument("--only", default="throttling,hidden,call")
    args = ap.parse_args()
    if not Path(electron()).exists():
        sys.exit("no Electron: run `npm ci` in desktop/ first")
    subprocess.run(["npm", "run", "build"], cwd=ROOT / "desktop", check=True, stdout=subprocess.DEVNULL)
    srv = Server()
    results = {}
    try:
        server, chan = seed(srv.base)
        profile = Path(tempfile.mkdtemp(prefix="desktop-idle-"))
        for part in args.only.split(","):
            print(part, flush=True)
            if part == "throttling":
                results[part] = run_app(srv.base, server, chan, "", profile, args.long)
            elif part == "hidden":
                results[part] = run_app(srv.base, server, chan, "hidden", profile)
            elif part == "call":
                results[part] = call_check(srv.base, server)
    finally:
        srv.stop()
    print(" ".join(f"{k}: {'pass' if v else 'FAIL'}" for k, v in results.items()))
    sys.exit(0 if results and all(results.values()) else 1)


if __name__ == "__main__":
    main()
