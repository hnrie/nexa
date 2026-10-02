#!/usr/bin/env python3
"""Takes the picture the front page shows of the app, from the app actually running.

Boots a throwaway chatd on the built web dist, sets up a small server with two
people in it, and photographs it: app.png, which is also the front page's link
preview. Nothing here is mocked up: what the page shows is what the app draws.
The loops, and the posters they start from, are tools/home_gifs.py's.

  PLAYWRIGHT_VENV=tools/.venv tools/.venv/bin/python tools/home_shots.py

E2E_WEB_DIST and E2E_CHATD (see tools/e2e.py) point it at a build of your own.
"""
import os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session, PASSWORD  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "web/public/home"
SHOT = (1440, 900)

# the first picture of Nexa many people see (it is the link preview too), so
# friends making plans rather than anything that needs explaining
CHANNELS = ["plans", "games", "music", "photos"]
CHAT = [
    ("alice", "game night on friday? 🎲"),
    ("bob", "yes!! i'll bring the new expansion"),
    ("alice", "nice. sam can't make it, so we'll call him from the voice channel"),
    ("bob", "can i share my screen at some point? i drew a map for the campaign"),
    ("alice", "go for it, i want to see it"),
    ("bob", "ok see you friday!"),
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    srv = Server()
    try:
        with sync_playwright() as p:
            args = [
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
                # a backgrounded tab gets frozen, its gateway drops, and the
                # other person reads as offline in the picture
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
            ]
            browser = p.chromium.launch(args=args)
            other = p.chromium.launch(args=args)
            alice = Session(browser, srv.base, "alice", OUT, viewport=SHOT)
            bob = Session(other, srv.base, "bob", OUT, viewport=SHOT)
            alice.register("Alice")
            bob.register("Bob")
            a, b = alice.page, bob.page

            # a server with two people talking in it
            a.goto(srv.base + "/channels/@me", wait_until="networkidle")
            a.click("button[aria-label='Add a Server']")
            a.fill("[data-testid=server-name]", "Orbit")
            # the dialog's own button: the sidebar behind it has "Create" buttons too
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
            a.locator("[data-channel]:has(span:text-is('general')) button").first.click()
            a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
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
            b.goto(link, wait_until="networkidle")
            b.click("[data-testid=invite-join]")
            b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)

            for who, line in CHAT:
                (alice if who == "alice" else bob).send(line)
                time.sleep(0.25)
            a.wait_for_selector("[data-id]:has-text('see you friday')", timeout=20000)
            b.bring_to_front()
            time.sleep(0.8)
            a.bring_to_front()
            a.wait_for_function(
                "() => document.querySelectorAll('[data-testid=member-list] [data-user]').length === 2",
                timeout=20000,
            )
            # a tooltip left open by the last click would end up in the picture
            a.mouse.move(820, 150)
            a.keyboard.press("Escape")
            time.sleep(1.5)
            a.screenshot(path=str(OUT / "app.png"))
            print("wrote app.png")

            browser.close()
            other.close()
    finally:
        srv.stop()
    return 0


sys.exit(main())
