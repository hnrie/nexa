#!/usr/bin/env python3
"""Seeds a fresh throwaway chatd with people, a server and one message of every
kind of formatting, for looking at how the client draws them.

Registers alice and bob (password: correct horse battery staple), has alice
make a server, which comes with #general and a General voice channel, and
brings bob in through an invite. Then alice posts one message of every kind of
formatting, one at a time, each waited for before the next: typed quickly,
they race and land as one scrambled message, which is useless for looking at
how each of them is drawn.

  tools/seed.py BASE [--no-formatting]

Sign in as bob to see them as someone else's. It prints the server and channel
ids at the end.
"""
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

FORMATTING = [
    "----- formatting check -----",
    "plain text, nothing special",
    "**bold** and *italic* and ***both*** and ~~struck~~ and __underline__",
    "`inline code` in a sentence and a `second one` right after",
    "> a block quote\n> over two lines",
    "- a bullet\n- another bullet\n- a third",
    "1. first\n2. second\n3. third",
    "# A heading",
    "## A smaller heading",
    "### Smaller still",
    "-# small subtext under everything",
    "a link to https://example.com and one that is [named](https://example.com)",
    "||a spoiler you have to tap|| and text after it",
    "emoji: \U0001F600 \U0001F389 \U0001F525 in a sentence",
    "\U0001F600\U0001F389\U0001F525",
    "```js\nconst x = 1;\nconsole.log(x);\n```",
    "a mention of @bob and a channel #general",
    "<t:1789700000:F> is a timestamp and <t:1789700000:R> is a relative one",
    "a very long line of `inline code that is long enough to wrap onto a second line on a phone` and then more words after it",
    "a very long line that should wrap onto several lines on a phone screen because it just keeps going and going past any reasonable width",
]


def post(sess: Session, text: str) -> None:
    p = sess.page
    box = sess.composer()
    box.click()
    parts = text.split("\n")
    for i, part in enumerate(parts):
        p.keyboard.type(part, delay=4)
        if i < len(parts) - 1:
            p.keyboard.press("Shift+Enter")
    # the mention and emoji pickers take Enter for themselves
    if "@" in text or "#general" in text:
        p.keyboard.press("Escape")
    p.keyboard.press("Enter")
    p.wait_for_function("() => (document.querySelector('textarea')?.value ?? 'x') === ''", timeout=20000)
    p.wait_for_timeout(400)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--no-formatting", action="store_true")
    args = ap.parse_args()
    out = Path("/tmp/nexa-seed")
    out.mkdir(exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        alice = Session(browser, args.base, "alice", out)
        bob = Session(browser, args.base, "bob", out)
        alice.register("Alice")
        bob.register("Bob")
        print("registered alice and bob")

        a = alice.page
        a.goto(args.base + "/channels/@me", wait_until="networkidle")
        a.click("button[aria-label='Add a Server']")
        a.fill("[data-testid=server-name]", "Alice's server")
        a.click("button:has-text('Create')")
        a.wait_for_url("**/channels/*/*", timeout=20000)
        a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
        server_id, general_id = a.url.split("/channels/")[1].split("/")[:2]

        a.click("button[aria-label='Invite People']")
        box = a.locator("[data-testid=invite-link]")
        box.wait_for(timeout=15000)
        link = ""
        for _ in range(50):
            link = box.input_value()
            if "#k=" in link:
                break
            time.sleep(0.1)
        if "#k=" not in link:
            raise SystemExit(f"the invite never got its key: {link!r}")
        a.keyboard.press("Escape")

        b = bob.page
        b.goto(link, wait_until="networkidle")
        b.click("[data-testid=invite-join]")
        b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
        print("bob joined", server_id)

        if not args.no_formatting:
            for n, text in enumerate(FORMATTING, 1):
                post(alice, text)
                print(f"  posted {n}/{len(FORMATTING)}")

        voice = a.evaluate(
            "() => [...document.querySelectorAll('[data-channel]')]"
            ".filter(e => e.textContent.trim() === 'General').map(e => e.getAttribute('data-channel'))[0] ?? null"
        )
        print("SERVER", server_id)
        print("GENERAL", general_id)
        print("VOICE", voice)
        errors = alice.errors + bob.errors
        if errors:
            print("page errors:", *errors[:10], sep="\n  ")
        browser.close()


if __name__ == "__main__":
    main()
