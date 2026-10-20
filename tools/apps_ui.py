#!/usr/bin/env python3
"""Uses an app the way a person does, in a headless browser, and films it.

  tools/apps_ui.py [--keep] [--serve] [--port N] [--sizes 1366x768,411x914]

It starts a throwaway chatd (E2E_CHATD and E2E_WEB_DIST name a scratch
build, as for tools/e2e.py), sets up the same server, app and discord.py test
bot as tools/bot_e2e.py (BOT_E2E_PYTHON is a Python with discord.py), and
then, as bob, at each size: reads the bot's message, types a slash and picks
its commands, fills their options in, sees an answer only he can see and one
still thinking, presses its button, picks from its select menu, fills in its
form, uses its entry in a message's menu and its suggestions for an option.
Every step is checked on screen and photographed into tools/out/apps-ui.
With --serve the server and the bot are left running for a person to try;
--port fixes its address (for an Android build pointed at it).
"""
import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from bot_e2e import Bot, bot_id, setup  # noqa: E402
from e2e import Server, Session, png_bytes  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402


def step(what):
    print("  ok:", what)


def composer(p):
    return p.locator("textarea[aria-label^='Message']")


def type_command(p, letters):
    box = composer(p)
    box.click()
    box.fill("")
    box.type("/" + letters, delay=30)


def pick_suggestion(p, text):
    p.locator(f"#composer-suggestions button[role=option]:has-text('{text}')").first.click()


def flow(s, out, base, sid, general, failures):
    p = s.page
    size = f"{p.viewport_size['width']}"
    p.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
    s.dismiss_whats_new()

    def attempt(name, fn):
        try:
            fn()
        except Exception as e:  # keep going: one broken step should not hide the rest
            failures.append(f"{size}: {name}: {e}")
            print(f"  FAIL {name}: {e}")
            try:
                s.shot(f"fail-{name}")
            except Exception:
                pass
            p.keyboard.press("Escape")

    def message():
        row = p.locator("[data-id]:has([data-testid=app-button])").first
        row.wait_for(timeout=20000)
        row.locator("[data-testid=app-tag]").wait_for(timeout=5000)
        row.locator("[data-testid=app-button]").first.wait_for(timeout=5000)
        row.scroll_into_view_if_needed()
        step(f"{size}: the bot's message shows with its tag, button and menu")
        s.shot("apps-message")

    def commands():
        type_command(p, "")
        p.wait_for_selector("#composer-suggestions button[role=option]:has-text('/echo')", timeout=10000)
        step(f"{size}: a slash lists the app's commands under the app")
        s.shot("apps-commands")

    def echo():
        type_command(p, "ec")
        pick_suggestion(p, "/echo")
        p.wait_for_selector("[data-testid=command-box]", timeout=5000)
        p.keyboard.type("hello there")
        p.click("[data-testid=add-option-times]")
        p.keyboard.type("2")
        step(f"{size}: picking a command gives a slot for each option")
        s.shot("apps-slots")
        p.keyboard.press("Enter")
        p.wait_for_selector("[data-id]:has-text('hello there hello there') [data-testid=only-you]", timeout=15000)
        p.locator("[data-id]:has-text('hello there hello there')").last.scroll_into_view_if_needed()
        step(f"{size}: an answer only bob sees says so")
        s.shot("apps-ephemeral")
        if size == "1366":
            line = p.locator("[data-testid=interaction-line]").last
            line.get_by_test_id("used-command").hover()
            tip = p.get_by_role("tooltip")
            tip.wait_for(timeout=3000)
            expected = "/echo text: hello there times: 2"
            if tip.inner_text().strip() != expected:
                raise AssertionError(f"command tooltip should show its submitted options: {tip.inner_text()!r}")
            step(f"{size}: hovering the used command shows its options")
            s.shot("apps-used-options")
            p.mouse.move(0, 0)
        else:
            # a touch screen has no hover: a tap shows them under the line
            line = p.locator("[data-testid=interaction-line]").last
            line.get_by_test_id("used-command").tap()
            details = line.get_by_test_id("used-command-details")
            details.wait_for(timeout=3000)
            if details.inner_text().strip() != "/echo text: hello there times: 2":
                raise AssertionError(f"a tap should show the submitted options: {details.inner_text()!r}")
            step(f"{size}: tapping the used command shows its options")
            s.shot("apps-used-options")

    def whole_command():
        # Ctrl+A in an empty option takes the whole command, and Backspace clears it
        type_command(p, "ec")
        pick_suggestion(p, "/echo")
        p.wait_for_selector("[data-testid=command-box]", timeout=5000)
        p.keyboard.type("words")
        p.keyboard.press("ControlOrMeta+a")  # the option's words
        p.keyboard.press("ControlOrMeta+a")  # then the whole command
        p.wait_for_selector("[data-testid=command-box][data-all-selected]", timeout=3000)
        step(f"{size}: Ctrl+A twice takes the whole command")
        s.shot("apps-whole-command")
        p.keyboard.press("Backspace")
        p.wait_for_selector("[data-testid=command-box]", state="detached", timeout=3000)
        if composer(p).input_value() != "":
            raise AssertionError(f"the box should be empty: {composer(p).input_value()!r}")
        step(f"{size}: Backspace then clears it")

    def option_emoji():
        # ":name" in a command's text option offers emoji, as the message box does
        type_command(p, "ec")
        pick_suggestion(p, "/echo")
        p.wait_for_selector("[data-testid=command-box]", timeout=5000)
        p.keyboard.type("hi :grinning")
        p.wait_for_selector("#composer-suggestions button[role=option]", timeout=8000)
        step(f"{size}: a command option offers emoji for :name")
        s.shot("apps-option-emoji")
        p.keyboard.press("Enter")
        value = p.locator("[data-testid=slot-text] input").input_value()
        if "\U0001F600" not in value:
            raise AssertionError(f"the emoji should go into the option: {value!r}")
        step(f"{size}: picking one puts the emoji in the option")
        p.keyboard.press("Escape")

    def slow():
        type_command(p, "slow")
        pick_suggestion(p, "/slow")
        p.keyboard.press("Enter")
        p.wait_for_selector("[data-testid=app-thinking]", timeout=10000)
        step(f"{size}: a deferred answer thinks")
        s.shot("apps-thinking")
        p.wait_for_selector("text=thought about it", timeout=15000)
        step(f"{size}: and is filled in")

    def button():
        row = p.locator("[data-id]:has([data-testid=app-button])").first
        row.locator("[data-testid=app-button]").first.click()
        p.wait_for_selector("text=pressed by bob", timeout=15000)
        step(f"{size}: pressing the button changes the message")

    def select():
        row = p.locator("[data-id]:has([data-testid=app-select])").first
        row.scroll_into_view_if_needed()
        row.locator("[data-testid=app-select]").click()
        p.wait_for_selector("[data-testid=app-select-list]", timeout=5000)
        step(f"{size}: the select menu opens its list")
        s.shot("apps-select")
        p.locator("[data-testid=app-select-list] [role=option]:has-text('Blue')").click()
        p.wait_for_selector("text=picked blue", timeout=15000)
        step(f"{size}: picking sends it to the app")

    def form():
        type_command(p, "form")
        pick_suggestion(p, "/form")
        p.keyboard.press("Enter")
        p.wait_for_selector("[data-testid=app-form]", timeout=10000)
        step(f"{size}: the app's form opens")
        s.shot("apps-form")
        p.locator("[data-testid=app-form] input").first.fill("forty two")
        p.click("[data-testid=app-form-submit]")
        p.wait_for_selector("text=form said forty two", timeout=15000)
        step(f"{size}: the form's answer comes back")

    def menu():
        row = p.locator("[data-id]:has-text('pressed by bob')").last
        row.scroll_into_view_if_needed()
        # An open menu closes when anything scrolls, as it should, and the
        # scroll that brought the row into view fires its event a frame later:
        # let it settle, and open the menu again if it went anyway.
        p.wait_for_timeout(400)
        for tries in range(3):
            row.click(button="right", position={"x": 120, "y": 12})
            p.wait_for_selector("[role=menu] [role=menuitem]:has-text('Apps')", timeout=5000)
            try:
                p.locator("[role=menu] [role=menuitem]:has-text('Apps')").click(timeout=4000)
                break
            except Exception:
                if tries == 2:
                    raise
                p.keyboard.press("Escape")
                p.wait_for_timeout(400)
        p.wait_for_selector("[role=menuitem]:has-text('Quote')", timeout=5000)
        step(f"{size}: a message's menu has the app's entry")
        s.shot("apps-menu")
        p.locator("[role=menuitem]:has-text('Quote')").click()
        p.wait_for_selector("text=quoting: pressed by bob", timeout=15000)
        step(f"{size}: the entry reaches the app with the message")

    def menu_on_a_picture():
        # a person's message is sealed: the app gets its words and its picture
        # through the copy the person's app seals for it (or the keys, when it reads everything)
        words = f"look at this {size}"
        p.set_input_files("input[type=file]", {"name": "pic.png", "mimeType": "image/png", "buffer": png_bytes(48, 32, (200, 90, 60))})
        s.send(words)
        row = p.locator(f"[data-id]:has-text('{words}')").last
        row.locator("img").first.wait_for(timeout=20000)
        p.wait_for_timeout(400)
        for tries in range(3):
            row.click(button="right", position={"x": 120, "y": 12})
            try:
                p.locator("[role=menu] [role=menuitem]:has-text('Apps')").click(timeout=4000)
                p.locator("[role=menuitem]:has-text('Quote')").click(timeout=4000)
                break
            except Exception:
                if tries == 2:
                    raise
                p.keyboard.press("Escape")
                p.wait_for_timeout(400)
        p.wait_for_selector(f"text=quoting: {words} [files: pic.png", timeout=15000)
        got = p.locator(f"text=quoting: {words}").last.inner_text()
        if "pic.png 0/" in got:
            raise AssertionError(f"the picture did not download: {got}")
        step(f"{size}: a message's entry hands the app its words and picture ({got})")

    def autocomplete():
        type_command(p, "fruit")
        pick_suggestion(p, "/fruit")
        p.keyboard.type("ap")
        p.wait_for_selector("#composer-suggestions button[role=option]:has-text('apricot')", timeout=10000)
        step(f"{size}: the app suggests values as an option is typed")
        s.shot("apps-autocomplete")
        p.keyboard.press("Tab")
        p.keyboard.press("Enter")
        p.wait_for_selector("text=you picked apple", timeout=15000)
        step(f"{size}: a suggestion picked is sent")

    for name, fn in [("message", message), ("commands", commands), ("echo", echo), ("whole-command", whole_command), ("option-emoji", option_emoji), ("slow", slow), ("button", button), ("select", select), ("form", form), ("menu", menu), ("menu_on_a_picture", menu_on_a_picture), ("autocomplete", autocomplete)]:
        attempt(name, fn)


def pages(alice, bob, base, sid, general, app, failures, a_api=None, b_api=None):
    """The pages around apps: the Developer Portal, the consent page, a server's
    apps, Authorized Apps, a bot's profile and the mark on a channel it reads."""
    a, b = alice.page, bob.page
    size = f"{a.viewport_size['width']}"

    def attempt(name, fn, sess):
        try:
            fn()
        except Exception as e:
            failures.append(f"{size}: {name}: {e}")
            print(f"  FAIL {name}: {e}")
            try:
                sess.shot(f"fail-{name}")
            except Exception:
                pass
            sess.page.keyboard.press("Escape")

    def open_settings(sess, nav):
        p = sess.page
        p.goto(f"{base}/channels/@me", wait_until="networkidle")
        sess.dismiss_whats_new()
        if p.viewport_size["width"] < 768:
            # a phone keeps the user panel in the drawer
            p.click("button[aria-label='Open Navigation']")
            p.wait_for_timeout(400)
        p.click("button[aria-label='User Settings']")
        p.locator(f"[data-nav={nav}]").first.click()
        p.wait_for_timeout(400)

    def portal():
        open_settings(alice, "developers")
        a.wait_for_selector("[data-testid=app-row]", timeout=10000)
        step(f"{size}: the portal lists alice's app")
        alice.shot("portal-list")
        a.click("[data-testid=app-row]")
        a.wait_for_selector("[data-testid=app-id]", timeout=10000)
        alice.shot("portal-general")
        for tab in ("bot", "install", "oauth", "commands"):
            a.click(f"[data-testid=portal-tab-{tab}]")
            a.wait_for_timeout(500)
            alice.shot(f"portal-{tab}")
        step(f"{size}: each of the app's tabs opens")
        a.click("[data-testid=portal-tab-bot]")
        a.wait_for_selector("[data-testid=reading-glass]", timeout=5000)
        a.locator("[data-testid=reading-glass]").scroll_into_view_if_needed()
        alice.shot("portal-glass")
        step(f"{size}: the Bot tab shows what the app reads")

    def make_app():
        open_settings(alice, "developers")
        a.click("[data-testid=app-new]")
        a.fill("[data-testid=app-name]", f"Weather {size}")
        a.click("[data-testid=app-create]")
        a.wait_for_selector("[data-testid=new-token]", timeout=10000)
        step(f"{size}: a new app shows its token once")
        alice.shot("portal-new-token")
        a.locator("[data-testid=new-token] button").last.click()
        a.wait_for_selector("[data-testid=app-id]", timeout=10000)
        # a new app reads only what is sent to it: the glass shows the rest sealed
        a.click("[data-testid=portal-tab-bot]")
        a.wait_for_selector("[data-testid=reading-glass]", timeout=5000)
        a.locator("[data-testid=reading-glass]").scroll_into_view_if_needed()
        alice.shot("portal-glass-sealed")
        step(f"{size}: a new app reads only what is sent to it")

    def consent():
        b.goto(f"{base}/oauth2/authorize?client_id={app['id']}&scope=applications.commands&integration_type=1", wait_until="networkidle")
        b.wait_for_selector("[data-testid=authorize-page] [data-testid=authorize]", timeout=10000)
        step(f"{size}: the consent page offers the app for bob's account")
        bob.shot("consent-account")
        b.click("[data-testid=authorize]")
        b.wait_for_selector("text=/added to your account/", timeout=10000)
        step(f"{size}: bob adds it to his account")
        a.goto(f"{base}/oauth2/authorize?client_id={app['id']}&scope=bot%20applications.commands&permissions=268446720", wait_until="networkidle")
        a.wait_for_selector("[data-testid=authorize-page] [data-testid=reading-glass]", timeout=10000)
        step(f"{size}: the consent page shows servers, permissions and what the app reads")
        alice.shot("consent-server")

    def authorized():
        open_settings(bob, "authorizedApps")
        b.wait_for_selector("[data-testid=authorized-app]", timeout=10000)
        step(f"{size}: Authorized Apps lists the app")
        bob.shot("authorized-apps")

    def share_warning():
        # in a DM the app is only on bob's account: he is asked before it gets alice's message
        _, me_b = b_api.call("GET", "/api/v1/users/@me", expect=200)
        _, dm = a_api.call("POST", "/api/v1/users/@me/channels", {"recipient_ids": [me_b["id"]]})
        words = f"a secret for the dm {size}"
        alice.page.goto(f"{base}/channels/@me/{dm['id']}", wait_until="networkidle")
        alice.dismiss_whats_new()
        alice.send(words)
        b.goto(f"{base}/channels/@me/{dm['id']}", wait_until="networkidle")
        bob.dismiss_whats_new()
        row = b.locator(f"[data-id]:has-text('{words}')").last
        row.wait_for(timeout=20000)
        b.wait_for_timeout(400)
        for tries in range(3):
            row.click(button="right", position={"x": 120, "y": 12})
            try:
                b.locator("[role=menu] [role=menuitem]:has-text('Apps')").click(timeout=4000)
                b.locator("[role=menuitem]:has-text('Peek')").click(timeout=4000)
                break
            except Exception:
                if tries == 2:
                    raise
                b.keyboard.press("Escape")
                b.wait_for_timeout(400)
        b.wait_for_selector("text=Share This Message with Lab Bot?", timeout=8000)
        step(f"{size}: bob is asked before an app on his account gets alice's message")
        bob.shot("share-warning")
        b.locator("[role=dialog] button:has-text('Continue')").click()
        b.wait_for_selector(f"text=quoting: {words}", timeout=15000)
        step(f"{size}: after Continue the app gets it")

    def app_link():
        # an app's install link in chat is a card of the app, whose Add App comes back here
        a.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        alice.dismiss_whats_new()
        alice.send(f"{base}/oauth2/authorize?client_id={app['protocol_id']}&scope=applications.commands&integration_type=1 ({size})")
        b.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        bob.dismiss_whats_new()
        card = b.locator("[data-testid=app-link-card][data-app-state=ready]").last
        card.wait_for(timeout=15000)
        card.scroll_into_view_if_needed()
        b.wait_for_timeout(400)
        step(f"{size}: an app's install link shows the app's card")
        bob.shot("app-link-card")
        here = b.url
        card.locator("[data-testid=app-link-add]").click()
        b.wait_for_selector("[data-testid=authorize-page] [data-testid=authorize]", timeout=10000)
        b.click("[data-testid=authorize]")
        b.wait_for_url(here, timeout=10000)
        step(f"{size}: its Add App comes back to the channel")

    def staff_bots():
        # Nexa's staff (alice, the first account) see apps in a Bots tab of their own
        a.goto(f"{base}/channels/@admin/bots", wait_until="networkidle")
        alice.dismiss_whats_new()
        a.wait_for_selector(f"[data-testid=bot-card][data-app='{app['id']}']", timeout=10000)
        step(f"{size}: the staff's Bots tab lists the app with its owner")
        alice.shot("staff-bots")
        a.click(f"[data-testid=bot-card][data-app='{app['id']}'] [data-testid=bot-card-moderate]")
        a.wait_for_url(f"**/channels/@admin/users/{app['id']}", timeout=10000)
        step(f"{size}: Moderate opens the bot's own page")

    def server_apps():
        a.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        alice.dismiss_whats_new()
        if a.viewport_size["width"] < 768:
            a.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        if a.viewport_size["width"] < 768:
            # the phone's header has a menu; the server's settings are in the drawer's server menu
            a.click("button[aria-label='Open Navigation'], button[aria-label*='Navigation']")
            a.wait_for_timeout(400)
        # through the server's menu, as a person does
        a.click("button:has-text('Bot Lab')")
        a.click("text=Server Settings")
        a.locator("[data-nav=integrations]").first.click()
        a.wait_for_selector("[data-testid=server-app]", timeout=10000)
        a.locator("[data-testid=server-app] button").first.click()
        a.wait_for_timeout(600)
        step(f"{size}: Server Settings lists the app with who can use its commands")
        alice.shot("server-apps")

    def profile_and_start():
        b.goto(f"{base}/channels/{sid}/{general}", wait_until="networkidle")
        bob.dismiss_whats_new()
        # the header leaves the topic its room; the start of the channel names the app that reads it
        if NO_CONTENT:
            return profile()
        start = b.get_by_text("except from apps that read every message").first
        start.wait_for(state="attached", timeout=10000)
        start.scroll_into_view_if_needed()
        b.wait_for_timeout(300)
        if b.locator("[data-testid=reading-apps]").count() or "Lab Bot" not in start.inner_text():
            raise AssertionError("the start of the channel should name the app that reads it, and the header say nothing")
        step(f"{size}: the start of the channel names the app that reads it")
        bob.shot("reading-start")
        profile()

    def profile():
        b.locator("[data-author='" + app["id"] + "']").first.click()
        b.wait_for_selector("[data-testid=profile-add-app], [data-testid=bot-tag], [data-testid=app-tag]", timeout=8000)
        step(f"{size}: the bot's profile says it is an app")
        bob.shot("bot-profile")
        # Add App on the card, and back to the channel once it is added
        here = b.url
        b.click("[data-testid=profile-popout-card] [data-testid=profile-add-app]")
        b.wait_for_selector("[data-testid=authorize-page]", timeout=10000)
        choice = b.locator("[data-testid=authorize-page] [data-testid=install-account]")
        if choice.count():
            choice.first.click()
        b.wait_for_selector("[data-testid=authorize-page] [data-testid=authorize]", timeout=10000)
        b.click("[data-testid=authorize]")
        b.wait_for_url(here, timeout=10000)
        b.wait_for_selector("text=/added to your account/", timeout=5000)
        step(f"{size}: Add App on the bot's card brings bob back to the channel he was in")
        bob.shot("add-app-back")

    for name, fn, sess in [("portal", portal, alice), ("make-app", make_app, alice), ("consent", consent, bob), ("authorized", authorized, bob), ("share-warning", share_warning, bob), ("app-link", app_link, bob), ("staff-bots", staff_bots, alice), ("server-apps", server_apps, alice), ("profile", profile_and_start, bob)]:
        attempt(name, fn, sess)


# --no-content: the app reads only what is sealed for it
NO_CONTENT = False


def main():
    global NO_CONTENT
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--serve", action="store_true", help="leave the server and the bot running afterwards")
    ap.add_argument("--sizes", default="1366x768,411x914")
    ap.add_argument("--pages-only", action="store_true", help="skip using the app in a channel; only visit the pages around apps")
    ap.add_argument("--port", type=int, help="the throwaway server's port (default: any free one)")
    ap.add_argument("--no-content", action="store_true", help="the app has no Message Content: it reads only the copies people's apps seal for it")
    args = ap.parse_args()
    # each step shows as it happens, also when the output goes to a file and the run then keeps serving
    sys.stdout.reconfigure(line_buffering=True)
    py = os.environ.get("BOT_E2E_PYTHON")
    if not py:
        print("set BOT_E2E_PYTHON to a Python with discord.py")
        return 2
    out = ROOT / "tools/out/apps-ui"
    out.mkdir(parents=True, exist_ok=True)
    srv = Server(keep=args.keep or args.serve, port=args.port)
    failures = []
    bot = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            alice = Session(browser, srv.base, "alice", out)
            alice.register()
            bob = Session(browser, srv.base, "bob", out)
            bob.register()
            a, b, sid, general, app, token = setup(srv.base, alice, bob, out)
            env = None
            NO_CONTENT = args.no_content
            if args.no_content:
                a.call("PATCH", f"/api/v1/applications/{app['id']}", {"intents": {"presence": True, "members": True, "message_content": False}}, expect=200)
                env = {**os.environ, "BOT_NO_CONTENT": "1"}
            bot = Bot("discord.py", [py, str(ROOT / "tools/bots/dpy_bot.py"), srv.base, token, bot_id(sid)], env=env)
            bot.wait("steps_done", 90)
            # the app can also be added to people's accounts, for the consent page and Authorized Apps
            a.call("PATCH", f"/api/v1/applications/{app['id']}", {"integration_types": {"0": {"oauth2_install_params": {"scopes": ["bot", "applications.commands"], "permissions": "8"}}, "1": {"oauth2_install_params": {"scopes": ["applications.commands"], "permissions": "0"}}}}, expect=200)
            for size in args.sizes.split(","):
                w, h = (int(x) for x in size.split("x"))
                s = Session(browser, srv.base, "bob", out, viewport=(w, h))
                s.login()
                if not args.pages_only:
                    flow(s, out, srv.base, sid, general, failures)
                al = Session(browser, srv.base, "alice", out, viewport=(w, h))
                al.login()
                pages(al, s, srv.base, sid, general, app, failures, a, b)
                for e in s.errors + al.errors:
                    print("  page:", e)
            browser.close()
        if args.serve:
            for f in failures:
                print("FAIL", f)
            print(f"serving at {srv.base} (alice and bob, password as tools/e2e.py), bot running; Ctrl+C to stop")
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        if bot:
            bot.stop()
        srv.stop()
    # a run that served said them before it began serving
    if not args.serve:
        for f in failures:
            print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
