#!/usr/bin/env python3
"""Takes the pictures the front page shows, from the app actually running.

Boots a throwaway chatd on the built web dist, sets up a small server with two
people in it, and photographs the parts the page talks about. Nothing here is
mocked up: what the page shows is what the app draws.

  PLAYWRIGHT_VENV=tools/.venv tools/.venv/bin/python tools/home_shots.py
"""
import os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session, PASSWORD  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "web/public/home"
SHOT = (1440, 900)

CHAT = [
    ("alice", "morning! pushed the new build, calls are noticeably smoother now"),
    ("bob", "nice. the screen share audio worked first try on my machine"),
    ("alice", "that was the per-window capture. no more hearing yourself"),
    ("bob", "does it still hold up on a bad connection?"),
    ("alice", "yeah, tested it on a throttled link. it drops video before it drops you"),
    ("bob", "perfect. shipping it"),
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
            a.click("button:has-text('Create')")
            a.wait_for_url("**/channels/*/*", timeout=20000)
            a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
            server_id = a.url.split("/channels/")[1].split("/")[0]
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
            b.click("button:has-text('Accept Invite')")
            b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)

            for who, line in CHAT:
                (alice if who == "alice" else bob).send(line)
                time.sleep(0.25)
            a.wait_for_selector("[data-id]:has-text('shipping it')", timeout=20000)
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

            # the expression picker, open on the emoji it ships with. The frame
            # around it shows the chat behind, whose lines the crop would cut
            # mid-word at its edge, so the messages step out of the picture.
            a.add_style_tag(content="[data-id] { visibility: hidden !important; }")
            a.click("button[aria-label='Select emoji']")
            a.wait_for_selector("[data-testid=emoji-picker], [role=dialog]", timeout=15000)
            a.mouse.move(430, 150)
            time.sleep(2.0)
            picker = a.locator("[role=dialog], [class*=pop]").last.bounding_box()
            pad = 28
            a.screenshot(path=str(OUT / "express.png"), clip={
                "x": max(0, picker["x"] - pad),
                "y": max(0, picker["y"] - pad),
                "width": min(SHOT[0] - max(0, picker["x"] - pad), picker["width"] + pad * 2),
                "height": min(SHOT[1] - max(0, picker["y"] - pad), picker["height"] + pad * 2),
            })
            a.keyboard.press("Escape")
            a.evaluate("() => document.querySelectorAll('style').forEach((el) => el.textContent.includes('[data-id] { visibility') && el.remove())")
            print("wrote express.png")

            # Both of them in the server's voice channel. No cameras: the fake
            # one the browser offers is a green test card, and most calls look
            # like this anyway.
            for page in (b, a):
                page.locator("[data-channel]:has(span:text-is('General')) button").first.click()
                page.wait_for_selector("[data-testid=voice-status]", timeout=20000)
                time.sleep(1.0)
            a.wait_for_function(
                "() => document.querySelectorAll('[data-testid=voice-participants] [data-user]').length === 2",
                timeout=20000,
            )
            # wait for the two of them to actually be connected to each other,
            # so the picture is a call rather than a call starting
            a.wait_for_function(
                "() => !document.body.innerText.includes('connecting')",
                timeout=30000,
            )
            a.mouse.move(400, 500)
            time.sleep(2.5)
            a.screenshot(path=str(OUT / "call.png"))
            print("wrote call.png")
            browser.close()
            other.close()
    finally:
        srv.stop()
    return 0


sys.exit(main())
