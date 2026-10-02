#!/usr/bin/env python3
"""Discord activity sync end to end, on a throwaway server talking to a fake
Discord (internal/discordsync/fakediscord/cmd/fakediscord): alice links her
Discord account from Settings, Activity (Discord's own page is stood in for by
sending the browser straight back with a code), a song she plays on Discord
shows as her activity for bob, her Discord account leaves the activity server
and the banner offers to rejoin, and she disconnects. Along the way it checks
the phone's message box menu and that Home counts friend requests only.
Screenshots at desktop and phone sizes.

  PLAYWRIGHT_VENV=tools/.venv python3 tools/discord_e2e.py [--out tools/out/discord]

Like tools/e2e.py it runs bin/chatd and web/dist unless E2E_CHATD and
E2E_WEB_DIST name a build made somewhere else; E2E_FAKEDISCORD names a built
fake Discord, which is built into a temporary folder otherwise.
"""
import argparse, json, os, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session, free_port  # noqa: E402  (re-executes under PLAYWRIGHT_VENV)
from playwright.sync_api import sync_playwright  # noqa: E402

DISCORD_ID = "900000000000000100"


def control(base, path, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(base + path, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode()


def start_fake():
    binary = os.environ.get("E2E_FAKEDISCORD")
    if not binary:
        binary = str(Path(tempfile.mkdtemp(prefix="fakediscord-")) / "fakediscord")
        subprocess.run(["go", "build", "-o", binary, "./internal/discordsync/fakediscord/cmd/fakediscord"], cwd=ROOT, check=True)
    proc = subprocess.Popen([binary], stdout=subprocess.PIPE, text=True)
    url = proc.stdout.readline().strip()
    assert url.startswith("http"), url
    return proc, url


def song():
    now = int(time.time() * 1000)
    return [{
        "name": "Spotify", "type": 2, "id": "spotify:1", "details": "Never Gonna Give You Up", "state": "Rick Astley",
        "sync_id": "4cOdK2wGLETKBW3PvgPWqT", "assets": {"large_text": "Whenever You Need Somebody"},
        "timestamps": {"start": now - 61_000, "end": now + 152_000},
    }]


CALLBACK = "/api/v1/connections/discord/callback"


def link_through_ui(s, fake, code, asked=None):
    """Clicks Connect Discord; the browser's trip to Discord comes straight back with a code."""
    def to_discord(route):
        q = parse_qs(urlparse(route.request.url).query)
        if asked is not None:
            asked.append(q["redirect_uri"][0])
        back = q["redirect_uri"][0] + "?" + urlencode({"code": code, "state": q["state"][0]})
        route.fulfill(status=302, headers={"Location": back})
    s.page.route("https://discord.com/**", to_discord)
    s.page.click("[data-testid=discord-connect]")
    s.page.wait_for_selector("[data-testid=discord-account]", timeout=30000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tools/out/discord"))
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    fake, fake_url = start_fake()
    os.environ.update(DISCORD_CLIENT_ID="client-id", DISCORD_CLIENT_SECRET="client-secret", DISCORD_BOT_TOKEN="bot-token", DISCORD_API_URL=fake_url + "/api/v10")
    # the Developer Portal lists the server's callback, as a set-up one does, before chatd asks
    port = free_port()
    control(fake_url, "/_control/redirects", [f"http://127.0.0.1:{port}{CALLBACK}"])
    srv = Server(keep=args.keep, port=port)
    errors = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            alice = Session(browser, srv.base, "alice", out)
            bob = Session(browser, srv.base, "bob", out, viewport=(390, 844))
            try:
                run(args, srv, fake_url, browser, alice, bob, out, errors)
            except Exception:
                # what each of them was looking at when it went wrong
                for s in (alice, bob):
                    try:
                        s.shot("failure")
                    except Exception:
                        pass
                raise
            browser.close()
    finally:
        srv.stop()
        fake.terminate()
    if errors:
        print("\n".join(errors))
        raise SystemExit(f"{len(errors)} problems")
    print("ok")


def run(args, srv, fake_url, browser, alice, bob, out, errors):
    if True:
        if True:
            alice.register()
            bob.register()

            print("Settings, Activity before linking")
            alice.open_settings("activity")
            alice.page.wait_for_selector("[data-testid=discord-connect]")
            alice.shot("activity-unlinked")

            # alice is the first account, so she sees the bot's status: the callback in use, and no warning about it
            alice.page.wait_for_selector(f"[data-testid=discord-bot-status] >> text={srv.base}{CALLBACK}", timeout=10000)
            if alice.page.locator("[data-testid=discord-redirect-unlisted]").count() != 0:
                errors.append("a listed redirect is warned about")

            print("linking through Discord's page")
            asked = []
            link_through_ui(alice, fake_url, control(fake_url, f"/_control/user?id={DISCORD_ID}&username=alice_d"), asked)
            if asked != [srv.base + CALLBACK]:
                errors.append(f"Discord was asked to come back through {asked}")
            alice.page.wait_for_selector("text=Discord is connected", timeout=10000)
            alice.page.wait_for_selector("[data-testid=discord-status][data-tone=good]", timeout=10000)
            alice.shot("activity-linked")

            print("friends, so bob sees her status")
            alice.close_settings()
            # Home counts the friend request, and only that
            alice.add_friend("bob")
            bob.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            bob.page.wait_for_selector("[data-testid=home-count]", timeout=15000)
            bob.shot("home-request")
            bob.accept_friend("Alice")

            print("a song on Discord shows as her activity")
            control(fake_url, f"/_control/presence?id={DISCORD_ID}&status=online", song())
            alice.open_settings("activity")
            alice.page.wait_for_selector("text=Showing Now", timeout=15000)
            alice.page.wait_for_selector("text=Never Gonna Give You Up", timeout=5000)
            alice.shot("activity-song")
            alice.close_settings()

            print("bob sees it, and gets a message: a waiting icon, no number on Home")
            bob.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            # the friends list says who is playing, beside a note
            bob.page.wait_for_selector("text=Rick Astley", timeout=15000)
            bob.shot("dm-list-activity")
            alice.open_dm_with("Bob")
            dm = alice.page.url.rstrip("/").split("/")[-1]
            alice.send("hi bob, ive got the detections working")
            bob.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            bob.page.wait_for_selector("[data-testid=waiting-count]", timeout=15000)
            if bob.page.locator("[data-testid=home-count]").count() != 0:
                errors.append("Home shows a count for a message")
            bob.shot("home-message")

            print("spelling: contractions without their apostrophe and plain plurals are words")
            box = alice.composer()
            box.fill("Ive been happy, the detections work and ive checked teh rest")
            box.press("End")
            box.type(" ")
            alice.page.wait_for_selector("[data-testid=spell-lines] span", timeout=15000)
            alice.page.wait_for_timeout(500)
            marked = alice.page.locator("[data-testid=spell-lines] span").all_inner_texts()
            if marked != ["teh"]:
                errors.append(f"spelling marks {marked}, want only teh")
            alice.shot("spelling")
            box.fill("")

            print("a message to alice: its own waiting icon on the rail, nothing on Home")
            alice.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            bob.page.goto(f"{srv.base}/channels/@me/{dm}", wait_until="networkidle")
            bob.send("hey alice")
            alice.page.wait_for_selector("[data-testid=waiting-count]", timeout=15000)
            if alice.page.locator("[data-testid=home-count]").count() != 0:
                errors.append("Home counts a message")
            alice.shot("rail-waiting")
            alice.page.goto(f"{srv.base}/channels/@me/{dm}", wait_until="networkidle")

            print("the phone's message box keeps its tools behind one button")
            bob.page.goto(f"{srv.base}/channels/@me/{dm}", wait_until="networkidle")
            bob.page.wait_for_selector("[data-testid=composer-tools]", timeout=15000)
            if bob.page.locator("[data-testid=preview-toggle]").count() != 0 or bob.page.locator("[data-testid=format-open]").count() != 0:
                errors.append("the phone still shows the preview and format buttons")
            bob.page.click("[data-testid=composer-tools]")
            bob.page.wait_for_selector("[role=menu] >> text=Preview Message", timeout=5000)
            bob.shot("composer-tools")
            bob.page.click("[role=menu] >> text=Preview Message")
            bob.page.wait_for_timeout(300)
            bob.shot("composer-preview")

            print("leaving the activity server: the banner, and Rejoin")
            control(fake_url, f"/_control/leave?id={DISCORD_ID}")
            alice.page.wait_for_selector("[data-testid=discord-banner]", timeout=15000)
            alice.shot("discord-banner")
            alice.page.click("[data-testid=discord-banner-rejoin]")
            alice.page.wait_for_selector("[data-testid=discord-banner]", state="detached", timeout=15000)

            print("Activity on a phone")
            bob.page.goto(f"{srv.base}/channels/@me?settings=activity", wait_until="networkidle")
            bob.page.wait_for_selector("[data-testid=discord-connect]", timeout=15000)
            bob.shot("activity-phone")
            bob.close_settings()

            print("disconnecting")
            alice.open_settings("activity")
            alice.page.click("[data-testid=discord-unlink]")
            alice.page.wait_for_selector("[data-testid=discord-connect]", timeout=15000)
            alice.shot("activity-unlinked-again")

            print("linking as the desktop app does: the system's browser gets a page of its own, and the app hears of the link")
            started = alice.page.evaluate("""async () => {
                const res = await fetch('/api/v1/connections/discord/authorize', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('ec.token'), 'Content-Type': 'application/json'}, body: JSON.stringify({app: true})});
                return (await res.json()).url;
            }""")
            q = parse_qs(urlparse(started).query)
            code = control(fake_url, f"/_control/user?id={DISCORD_ID}&username=alice_d")
            # a browser signed in to nobody, which is what the system's often is
            for size in ((1366, 768), (390, 844)):
                other = browser.new_context(viewport={"width": size[0], "height": size[1]})
                page = other.new_page()
                if size[0] > 768:
                    page.goto(q["redirect_uri"][0] + "?" + urlencode({"code": code, "state": q["state"][0]}), wait_until="networkidle")
                    page.wait_for_selector("[data-testid=discord-connected][data-result=linked]", timeout=15000)
                    if urlparse(page.url).path != "/connected/discord":
                        errors.append(f"the app's browser ended at {page.url}")
                    # and the app, where alice is, shows the account without being asked
                    alice.page.wait_for_selector("[data-testid=discord-account]", timeout=15000)
                for result in ("linked", "denied", "expired", "taken", "failed"):
                    page.goto(f"{srv.base}/connected/discord?result={result}", wait_until="networkidle")
                    page.wait_for_selector(f"[data-testid=discord-connected][data-result={result}]", timeout=15000)
                    page.wait_for_timeout(700)
                    page.screenshot(path=str(out / f"connected-{result}-{size[0]}.png"))
                other.close()

            print("a redirect Discord does not list is said to the admin")
            control(fake_url, "/_control/redirects", ["https://somewhere-else.example" + CALLBACK])
            alice.page.wait_for_timeout(11000)  # the bot's status asks Discord again after ten seconds
            alice.page.goto(f"{srv.base}/channels/@me?settings=activity", wait_until="networkidle")
            alice.page.wait_for_selector("[data-testid=discord-redirect-unlisted]", timeout=15000)
            alice.page.locator("[data-testid=discord-bot-status]").scroll_into_view_if_needed()
            alice.shot("activity-redirect-unlisted")
            alice.close_settings()

            # the fake Discord account's picture is on Discord's real CDN, where it does not exist
            for s in (alice, bob):
                errors += [e for e in s.errors if "discord.com" not in e and "/media/proxy/" not in e]


if __name__ == "__main__":
    main()
