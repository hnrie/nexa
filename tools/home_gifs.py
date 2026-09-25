#!/usr/bin/env python3
"""Records the short loops the front page plays, from the app running for real.

Playwright films the window; ffmpeg turns the film into a GIF with a palette
built from the frames themselves, so the app's purples survive 256 colours.

  PLAYWRIGHT_VENV=tools/.venv tools/.venv/bin/python tools/home_gifs.py
"""
import shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "web/public/home"
WORK = Path("/tmp/home-gifs")
SIZE = (1280, 800)
CHANNELS = ["design", "builds", "music", "links", "random"]
TALK = {
    "design": ["the new picker lands tonight", "shipping the rounded tiles with it"],
    "builds": ["arm64 is up", "signed and notarised, no gatekeeper prompt"],
    "music": ["this album is unreasonably good", "putting it on in the call"],
    "links": ["read this one", "the section on key rotation is worth it"],
    "random": ["my cat walked across the keyboard", "she has commit access now"],
}


def clip(src: Path, stem: Path, tail: float, fps: int = 16, width: int = 900) -> None:
    """The last `tail` seconds of the recording, in two shapes.

    A page gets the webm, which is small and smooth, and the first frame
    becomes the poster, so the box is never empty while the loop loads and a
    reader who asked for less movement sees it on its own. (A GIF used to be
    made too, as a fallback inside the video element; every browser that runs
    the app plays video, so none ever fetched it.)
    """
    common = f"fps={fps},scale={width}:-1:flags=lanczos"
    run = lambda cmd: subprocess.run(cmd, check=True, capture_output=True)
    run([
        "ffmpeg", "-y", "-sseof", f"-{tail}", "-i", str(src), "-vf", common,
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1",
        "-pix_fmt", "yuv420p", "-an", str(stem.with_suffix(".webm")),
    ])
    run(["ffmpeg", "-y", "-sseof", f"-{tail}", "-i", str(src), "-vf", f"scale={width}:-1:flags=lanczos", "-frames:v", "1", str(stem.with_suffix(".png"))])
    for ext in (".webm", ".png"):
        f = stem.with_suffix(ext)
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("ffmpeg is not on PATH", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    srv = Server()
    try:
        with sync_playwright() as p:
            args = [
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
            ]
            b1 = p.chromium.launch(args=args)
            b2 = p.chromium.launch(args=args)
            alice = Session(b1, srv.base, "alice", WORK, viewport=SIZE, record=str(WORK / "speed"))
            bob = Session(b2, srv.base, "bob", WORK, viewport=SIZE, record=str(WORK / "call"))
            alice.register("Alice")
            bob.register("Bob")
            a, bp = alice.page, bob.page

            a.goto(srv.base + "/channels/@me", wait_until="networkidle")
            a.click("button[aria-label='Add a Server']")
            a.fill("[data-testid=server-name]", "Orbit")
            a.click("button:has-text('Create')")
            a.wait_for_url("**/channels/*/*", timeout=20000)
            a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
            server_id = a.url.split("/channels/")[1].split("/")[0]
            for n in CHANNELS:
                a.click("button[aria-label='Create Channel']")
                a.fill("[data-testid=channel-name]", n)
                a.click("button:has-text('Create Channel') >> nth=-1")
                a.wait_for_selector(f"[data-channel]:has(span:text-is('{n}'))", timeout=15000)
                time.sleep(0.2)
            # bob joins so the member list is not a lonely place
            a.click("button[aria-label='Invite People']")
            box = a.locator("[data-testid=invite-link]")
            box.wait_for(timeout=15000)
            link = ""
            for _ in range(60):
                link = box.input_value()
                if "#k=" in link:
                    break
                time.sleep(0.1)
            a.keyboard.press("Escape")
            bp.goto(link, wait_until="networkidle")
            bp.click("button:has-text('Accept Invite')")
            bp.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
            # something to read in each one
            for n, lines in TALK.items():
                a.locator(f"[data-channel]:has(span:text-is('{n}')) button").first.click()
                a.wait_for_selector(f"textarea[aria-label='Message #{n}']", timeout=15000)
                alice.send(lines[0])
                time.sleep(0.2)
                bp.locator(f"[data-channel]:has(span:text-is('{n}')) button").first.click()
                bp.wait_for_selector(f"textarea[aria-label='Message #{n}']", timeout=15000)
                bob.send(lines[1])
                time.sleep(0.4)

            # The call first, while nothing heavy is running: both of them in
            # the voice channel, the tone the browser plays for a fake
            # microphone lighting up the speaking rings.
            for page in (a, bp):
                page.locator("[data-channel]:has(span:text-is('General')) button").first.click()
                page.wait_for_selector("[data-testid=voice-status]", timeout=20000)
                time.sleep(0.8)
            for page in (a, bp):
                page.wait_for_function("() => !document.body.innerText.includes('connecting')", timeout=45000)
            bp.mouse.move(360, 500)
            time.sleep(3.2)
            bp.click("[data-testid=voice-mute]")
            time.sleep(1.8)
            bp.click("[data-testid=voice-mute]")
            time.sleep(2.4)
            bp.hover("[data-testid=call-fullscreen]")
            time.sleep(1.6)
            bp.mouse.move(360, 500)
            time.sleep(1.2)
            bp.close()
            bob.ctx.close()
            call = next(iter(sorted((WORK / "call").glob("*.webm"))), None)
            assert call is not None, "no recording of the call"
            clip(call, OUT / "call-loop", tail=9.0)

            # then the channels, one after another, as fast as a person clicks
            a.click("[data-testid=voice-status-leave]")
            time.sleep(1.0)
            a.locator("[data-channel]:has(span:text-is('general')) button").first.click()
            a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
            time.sleep(1.5)
            for n in CHANNELS + ["general"] + CHANNELS[:3]:
                a.locator(f"[data-channel]:has(span:text-is('{n}')) button").first.click()
                a.wait_for_selector(f"textarea[aria-label='Message #{n}']", timeout=10000)
                time.sleep(0.42)
            time.sleep(1.0)
            a.close()
            alice.ctx.close()
            video = next(iter(sorted((WORK / "speed").glob("*.webm"))), None)
            assert video is not None, "no recording of the channels"
            clip(video, OUT / "speed", tail=8.0)
            b1.close()
            b2.close()
    finally:
        srv.stop()
    return 0


sys.exit(main())
