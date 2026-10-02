#!/usr/bin/env python3
"""Records the short loops the front page plays, from the app running for real.

Playwright films the window and ffmpeg cuts the film into a small webm, with a
poster frame from the same film. Four loops:

  call-loop  two people in a voice channel, talking
  speed      a server's channels, one after another, as fast as a person clicks
  notes      two people writing in one note at once, a picture and all
  themes     a server in one colour theme after another

  PLAYWRIGHT_VENV=tools/.venv tools/.venv/bin/python tools/home_gifs.py

E2E_WEB_DIST and E2E_CHATD (see tools/e2e.py) film a build of your own.
"""
import os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "web/public/home"
WORK = Path(os.environ.get("HOME_GIFS_WORK", "/tmp/home-gifs"))
SIZE = (1280, 800)
# the note is filmed a little closer, so its words can be read at the size the page shows it
NOTE_SIZE = (1120, 700)
CHANNELS = ["design", "builds", "music", "links", "random"]
TALK = {
    "design": ["the new picker lands tonight", "shipping the rounded tiles with it"],
    "builds": ["arm64 is up", "signed and notarised, no gatekeeper prompt"],
    "music": ["this album is unreasonably good", "putting it on in the call"],
    "links": ["read this one", "the section on key rotation is worth it"],
    "random": ["my cat walked across the keyboard", "she has commit access now"],
}
# the themes the last loop goes through: the classic dark it starts in, then colours
THEMES = ["dark", "midnight", "forest", "rose", "amber", "ocean", "nexa-light", "sky", "rose-light", "nexa"]

# The picture Bob puts in the note, drawn by the browser itself so nothing
# else is needed: a sunset over the sea, in the app's own purples.
SUNSET = """<!doctype html><html><body style="margin:0;background:#000">
<div id="p" style="position:relative;width:1200px;height:760px;overflow:hidden;background:linear-gradient(180deg,#1b1240 0%,#4a2580 30%,#a4407e 52%,#f08a6c 66%,#ffc78a 71%)">
  <div style="position:absolute;left:600px;top:540px;width:260px;height:260px;margin:-130px;border-radius:50%;background:radial-gradient(circle,#fff6d8 0%,#ffe0a0 45%,#ffbf7a 62%,rgba(255,191,122,0) 72%)"></div>
  <div style="position:absolute;left:0;right:0;top:540px;height:60px;background:#2a1f55;clip-path:polygon(0 100%,0 62%,9% 40%,17% 58%,26% 30%,33% 52%,40% 66%,48% 100%)"></div>
  <div style="position:absolute;left:0;right:0;top:540px;height:60px;background:#352763;clip-path:polygon(60% 100%,66% 58%,74% 36%,82% 54%,90% 28%,100% 50%,100% 100%)"></div>
  <div style="position:absolute;left:0;right:0;top:598px;bottom:0;background:linear-gradient(180deg,#3b3a8a 0%,#20235c 55%,#120f33 100%)"></div>
  <div style="position:absolute;left:0;right:0;top:598px;bottom:0;background:repeating-linear-gradient(180deg,rgba(255,214,160,.55) 0 3px,transparent 3px 15px);-webkit-mask-image:radial-gradient(150px 140px at 50% 0,#000 0,rgba(0,0,0,.6) 45%,transparent 100%)"></div>
  <div style="position:absolute;left:0;right:0;top:598px;bottom:0;background:repeating-linear-gradient(180deg,rgba(255,255,255,.08) 0 2px,transparent 2px 22px)"></div>
</div></body></html>"""


def run(cmd: list) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def report(stem: Path) -> None:
    for ext in (".webm", ".png"):
        f = stem.with_suffix(ext)
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")


def clip(src: Path, stem: Path, tail: float, fps: int = 16, width: int = 900, still: float = 0.0) -> None:
    """The last `tail` seconds of the recording, in two shapes.

    A page gets the webm, which is small and smooth, and the frame `still`
    seconds in becomes the poster, so the box is never empty while the loop
    loads and a reader who asked for less movement sees it on its own. The
    front page starts playing from that same moment (the #t= on its source in
    HomePage.tsx), so the poster never jumps.
    """
    common = f"fps={fps},scale={width}:-1:flags=lanczos"
    run([
        "ffmpeg", "-y", "-sseof", f"-{tail}", "-i", str(src), "-vf", common,
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1",
        "-pix_fmt", "yuv420p", "-an", str(stem.with_suffix(".webm")),
    ])
    run(["ffmpeg", "-y", "-sseof", f"-{tail}", "-i", str(src), "-ss", str(still), "-vf", f"scale={width}:-1:flags=lanczos", "-frames:v", "1", str(stem.with_suffix(".png"))])
    report(stem)


def montage(src: Path, stem: Path, parts: list, fps: int = 16, width: int = 900) -> None:
    """Pieces of the recording, start and end in seconds, played one after another.

    The poster is a frame from the middle of the first piece.
    """
    chains = [f"[0:v]trim=start={a:.2f}:end={b:.2f},setpts=PTS-STARTPTS[p{i}]" for i, (a, b) in enumerate(parts)]
    joined = "".join(f"[p{i}]" for i in range(len(parts)))
    graph = ";".join(chains) + f";{joined}concat=n={len(parts)}:v=1:a=0,fps={fps},scale={width}:-1:flags=lanczos[out]"
    run([
        "ffmpeg", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[out]",
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1",
        "-pix_fmt", "yuv420p", "-an", str(stem.with_suffix(".webm")),
    ])
    a, b = parts[0]
    run(["ffmpeg", "-y", "-ss", f"{(a + b) / 2:.2f}", "-i", str(src), "-vf", f"scale={width}:-1:flags=lanczos", "-frames:v", "1", str(stem.with_suffix(".png"))])
    report(stem)


def film_of(folder: Path) -> Path:
    film = next(iter(sorted(folder.glob("*.webm"))), None)
    assert film is not None, f"nothing was filmed in {folder}"
    return film


def place_caret_after(page, text: str) -> None:
    """Puts the caret in the note just after `text`, as a click there would."""
    page.evaluate("""(text) => {
        const root = document.querySelector('[data-testid=note-surface]');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.data.indexOf(text);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i + text.length);
            r.collapse(true);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(r);
            root.focus();
            return;
        }
        throw new Error('not in the note: ' + text);
    }""", text)


def notes_take(browser_a, browser_b, base: str) -> None:
    """Bob writes in the note while Alice does, adds a picture, and Alice sizes it."""
    pic = WORK / "coast.png"
    tmp = browser_b.new_page(viewport={"width": 1200, "height": 760})
    tmp.set_content(SUNSET)
    tmp.locator("#p").screenshot(path=str(pic))
    tmp.close()

    alice = Session(browser_a, base, "alice", WORK, viewport=NOTE_SIZE, record=str(WORK / "notes"))
    bob = Session(browser_b, base, "bob", WORK, viewport=NOTE_SIZE)
    alice.login()
    bob.login()
    a, b = alice.page, bob.page
    surface = "[data-testid=note-surface]"

    a.goto(base + "/channels/@me/notes", wait_until="networkidle")
    a.click("[data-testid=note-new]")
    a.wait_for_selector("[data-testid=note-title]")
    a.fill("[data-testid=note-title]", "Weekend at the Coast")
    a.click(surface)
    for i, line in enumerate(["We leave Friday after class. Bring a jacket, it gets cold by the water.", "Things to bring:", "- sunscreen", "snacks for the train", "the speaker"]):
        if i:
            a.keyboard.press("Enter")
        a.keyboard.type(line, delay=4)
    a.wait_for_timeout(1500)
    note = a.url
    a.click("[data-testid=note-share]")
    a.wait_for_selector("[data-testid=share-note]")
    a.click("[data-testid=note-invite-role-2]")
    a.click("[data-testid=note-invite-row][data-user=bob] button")
    a.wait_for_timeout(800)
    a.keyboard.press("Escape")
    b.goto(base + "/channels/@me/notes", wait_until="networkidle")
    b.click("[data-testid=note-request-accept]")
    b.wait_for_timeout(800)
    b.goto(note, wait_until="networkidle")
    b.wait_for_selector(surface)
    a.mouse.move(NOTE_SIZE[0] - 40, NOTE_SIZE[1] - 40)
    # the "Sent Bob a request" toast goes before the take starts
    a.wait_for_selector("text=Sent Bob a request", state="detached", timeout=15000)
    # Alice's caret waits in the first line, so the list's own buttons are not up
    place_caret_after(a, "Friday")
    a.wait_for_timeout(1000)

    began = time.time()
    # Bob goes to the end of the list: his caret and name show on Alice's page
    place_caret_after(b, "the speaker")
    time.sleep(1.4)
    b.keyboard.press("Enter")
    time.sleep(0.3)
    # both write at once, in two places, a letter each in turn
    place_caret_after(a, "after class.")
    hers, his = " The train is at 9:40.", "board games"
    for i in range(max(len(hers), len(his))):
        if i < len(hers):
            a.keyboard.type(hers[i])
        if i < len(his):
            b.keyboard.type(his[i])
        time.sleep(0.07)
    time.sleep(0.8)
    # Bob adds a picture under the list, and a line under that
    b.keyboard.press("Enter")
    b.keyboard.press("Enter")
    b.set_input_files("[data-testid=note-file-input]", str(pic))
    a.wait_for_selector("[data-testid=note-file][data-state=ready]", timeout=30000)
    time.sleep(0.6)
    b.keyboard.press("Enter")
    b.keyboard.type("Same spot as last year", delay=55)
    time.sleep(0.5)
    # Alice makes the picture smaller by dragging its edge
    a.hover("[data-testid=note-file][data-visual]")
    time.sleep(0.7)
    box = a.locator("[data-testid=note-file-grip-end]").first.bounding_box()
    assert box is not None
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    a.mouse.move(x, y, steps=6)
    a.mouse.down()
    a.mouse.move(x - 105, y, steps=22)
    time.sleep(0.4)
    a.mouse.up()
    time.sleep(0.8)
    a.mouse.move(NOTE_SIZE[0] - 60, 120, steps=10)
    time.sleep(1.6)
    took = time.time() - began

    text = a.evaluate(f"() => document.querySelector('{surface}').innerText")
    assert "board games" in text and "The train is at 9:40." in text, text
    a.close()
    alice.ctx.close()
    b.close()
    bob.ctx.close()
    # its poster is the moment both have just written, Bob's name over his caret
    clip(film_of(WORK / "notes"), OUT / "notes", tail=round(took, 1), still=3.0)


def themes_take(browser, base: str, server_id: str) -> None:
    """The server, in one theme after another, each picked in Settings between the shots."""
    alice = Session(browser, base, "alice", WORK, viewport=SIZE, record=str(WORK / "themes"))
    started = time.time()
    alice.login()
    a = alice.page
    a.goto(base + f"/channels/{server_id}", wait_until="networkidle")
    a.locator("[data-channel]:has(span:text-is('general')) button").first.click()
    a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
    a.mouse.move(SIZE[0] - 300, 150)
    parts = []
    for theme in THEMES:
        a.click("[data-testid=user-settings]")
        a.click("[data-nav=appearance]")
        a.click(f"[data-theme-id={theme}]")
        a.wait_for_timeout(300)
        a.keyboard.press("Escape")
        a.wait_for_selector("[role=dialog][aria-label='User Settings']", state="detached", timeout=5000)
        a.mouse.move(SIZE[0] - 300, 150)
        # the dialog's way out and the colours settle; then a shot of the server
        time.sleep(0.6)
        at = time.time() - started
        time.sleep(1.5)
        parts.append((at + 0.15, at + 1.35))
    a.close()
    alice.ctx.close()
    montage(film_of(WORK / "themes"), OUT / "themes", parts)


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
                "--disable-background-timer-throttling",
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
            a.click("[role=dialog] button:has-text('Create')")
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
            bp.click("[data-testid=invite-join]")
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
            # and in #general, where the themes loop looks on
            for page in (a, bp):
                page.locator("[data-channel]:has(span:text-is('general')) button").first.click()
                page.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
            for who, line in [(alice, "morning! the new build is up, calls feel a lot smoother"), (bob, "nice, screen share with sound worked first try here"), (alice, "want to try it tonight?"), (bob, "yes! after dinner")]:
                who.send(line)
                time.sleep(0.3)

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
            clip(film_of(WORK / "call"), OUT / "call-loop", tail=9.0)
            # Bob stays signed in, unfilmed, so the loops after this show him online
            bob = Session(b2, srv.base, "bob", WORK, viewport=SIZE)
            bob.login()
            bob.page.goto(srv.base + f"/channels/{server_id}", wait_until="networkidle")

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
            # its first frame is the voice channel it starts from; two seconds
            # in, a channel with its messages says more on its own
            clip(film_of(WORK / "speed"), OUT / "speed", tail=8.0, still=2.0)

            # friends, so Alice can share a note with Bob straight from its Share dialog
            friend = Session(b1, srv.base, "alice", WORK, viewport=SIZE)
            friend.login()
            friend.add_friend("bob")
            bob.accept_friend("Alice")
            friend.ctx.close()
            notes_take(b1, b2, srv.base)
            bob.page.goto(srv.base + f"/channels/{server_id}", wait_until="networkidle")
            themes_take(b1, srv.base, server_id)
            bob.ctx.close()
            b1.close()
            b2.close()
    finally:
        srv.stop()
    return 0


sys.exit(main())
