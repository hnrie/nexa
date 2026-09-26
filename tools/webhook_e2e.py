#!/usr/bin/env python3
"""Webhooks end to end on a throwaway server: alice makes a server and a webhook
in Server Settings, Integrations; programs post every kind of message through
it (embeds, a gallery, link buttons, layout components, a poll, files, GitHub's
and Slack's formats, an edit); bob, on a phone, reads them and votes in the
poll, and alice sees the vote arrive. Screenshots at desktop and phone sizes.

  PLAYWRIGHT_VENV=tools/.venv python3 tools/webhook_e2e.py [--out tools/out/webhooks]

Like tools/e2e.py it runs bin/chatd and web/dist unless E2E_CHATD and
E2E_WEB_DIST name a build made somewhere else.
"""
import argparse, json, struct, sys, time, urllib.error, urllib.request, uuid, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Server, Session  # noqa: E402  (re-executes under PLAYWRIGHT_VENV)
from playwright.sync_api import sync_playwright  # noqa: E402


def png(w, h, top, bottom=None):
    """A PNG with a vertical gradient from top to bottom colour."""
    bottom = bottom or top
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    rows = []
    for y in range(h):
        f = y / max(1, h - 1)
        px = bytes(round(top[i] + (bottom[i] - top[i]) * f) for i in range(3))
        rows.append(b"\x00" + px * w)
    raw = b"".join(rows)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


RATE_LIMITED = []


def request(method, url, body=None, headers=None):
    """Sends one request, waiting out a rate limit the way webhook clients do."""
    for _ in range(10):
        req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            data = e.read()
            if e.code != 429:
                return e.code, data
            wait = float(json.loads(data).get("retry_after", 1))
            assert e.headers.get("X-RateLimit-Remaining") == "0" and e.headers.get("Retry-After"), dict(e.headers)
            RATE_LIMITED.append(wait)
            time.sleep(wait + 0.05)
    raise SystemExit("still rate limited")


def post_json(url, payload, headers=None):
    return request("POST", url, json.dumps(payload).encode(), {"Content-Type": "application/json", **(headers or {})})


def post_files(url, payload, files):
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n{json.dumps(payload)}\r\n'.encode()]
    for i, (name, data, ctype) in enumerate(files):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files[{i}]"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return request("POST", url, b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"})


def ok(res, what):
    status, body = res
    if status not in (200, 204):
        raise SystemExit(f"{what}: HTTP {status} {body[:400]!r}")
    print(f"  posted {what} ({status})")
    return json.loads(body) if status == 200 and body[:1] in (b"{", b"[") else body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tools/out/webhooks"))
    ap.add_argument("--keep", action="store_true", help="keep the server's data directory")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    srv = Server(keep=args.keep)
    print("server", srv.base, "data in", srv.dir)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            alice = Session(browser, srv.base, "alice", out)
            bob = Session(browser, srv.base, "bob", out, viewport=(390, 844))
            alice.ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=srv.base)
            alice.register("Alice")
            bob.register("Bob")
            a, b = alice.page, bob.page

            # a server, with bob in it
            a.goto(srv.base + "/channels/@me", wait_until="networkidle")
            a.click("button[aria-label='Add a Server']")
            a.fill("[data-testid=server-name]", "Nexa Dev")
            a.click("[role=dialog] button:has-text('Create')")
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
            a.keyboard.press("Escape")
            b.goto(link, wait_until="networkidle")
            b.click("[data-testid=invite-join]")
            b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
            print("bob joined", server_id)
            alice.send("Hi Bob, I am hooking up our build server.")
            a.wait_for_selector("[data-id]:has-text('hooking up')", timeout=20000)

            # Server Settings, Integrations: a new webhook with a picture and a name
            a.click("button:has-text('Nexa Dev')")
            a.click("text=Server Settings")
            a.click("[data-nav=integrations]")
            a.wait_for_selector("text=No webhooks yet", timeout=15000)
            alice.shot("integrations-empty")
            a.click("[data-testid=webhook-new]")
            a.wait_for_selector("[data-testid=webhook-card]", timeout=15000)
            a.wait_for_selector("[data-testid=webhook-name]", timeout=15000)
            with a.expect_file_chooser() as fc:
                a.click("button:has-text('Upload Picture')")
            fc.value.set_files({"name": "bot.png", "mimeType": "image/png", "buffer": png(256, 256, (88, 101, 242), (235, 69, 158))})
            a.wait_for_selector("[data-testid=crop-apply]", timeout=15000)
            a.click("[data-testid=crop-apply]")
            a.fill("[data-testid=webhook-name]", "Build Server")
            a.click("[data-testid=save]")
            a.wait_for_selector("text=Webhook changes saved.", timeout=15000)
            alice.shot("integrations")
            a.click("[data-testid=webhook-copy]")
            a.wait_for_selector("text=Webhook URL copied.", timeout=15000)
            url = a.evaluate("() => navigator.clipboard.readText()")
            assert "/api/webhooks/" in url, url
            print("webhook url", url)
            a.keyboard.press("Escape")
            a.wait_for_timeout(500)

            # programs post through it
            ok(post_json(url + "?wait=true", {"content": "Deploy of **nexa** `v2.4.0` started. Follow it at https://ci.example.com/deploys/42"}), "plain")
            chart = png(800, 300, (30, 90, 200), (120, 200, 255))
            logo = png(128, 128, (250, 166, 26), (237, 66, 69))
            ok(post_files(url + "?wait=true", {
                "username": "CI",
                "embeds": [{
                    "author": {"name": "nexa/web", "url": "https://github.com/example/nexa", "icon_url": "attachment://logo.png"},
                    "title": "Build #1289 passed",
                    "url": "https://ci.example.com/builds/1289",
                    "description": "All **1909** tests passed in `63s`.\n> Nothing flaky this time.",
                    "color": 0x57F287,
                    "fields": [
                        {"name": "Branch", "value": "`main`", "inline": True},
                        {"name": "Commit", "value": "[a1b2c3d](https://github.com/example/nexa/commit/a1b2c3d)", "inline": True},
                        {"name": "Duration", "value": "1m 03s", "inline": True},
                        {"name": "Changes", "value": "- Webhooks\n- Polls\n- Rich embeds"},
                    ],
                    "image": {"url": "attachment://chart.png"},
                    "thumbnail": {"url": "attachment://logo.png"},
                    "footer": {"text": "Nexa CI", "icon_url": "attachment://logo.png"},
                    "timestamp": "2026-09-26T21:00:00.000Z",
                }],
                "attachments": [{"id": 0, "description": "Test durations"}, {"id": 1}],
            }, [("chart.png", chart, "image/png"), ("logo.png", logo, "image/png")]), "rich embed")
            shots = [png(400, 300, c1, c2) for c1, c2 in [((237, 66, 69), (250, 166, 26)), ((87, 242, 135), (35, 165, 90)), ((88, 101, 242), (60, 69, 165)), ((235, 69, 158), (140, 40, 100))]]
            ok(post_files(url + "?wait=true", {
                "username": "Screenshots",
                "embeds": [{"title": "Nightly screenshots", "url": "https://ci.example.com/shots", "description": "Four views from last night's run.", "image": {"url": "attachment://s1.png"}, "color": 0x5865F2}]
                + [{"url": "https://ci.example.com/shots", "image": {"url": f"attachment://s{i}.png"}} for i in range(2, 5)],
            }, [(f"s{i + 1}.png", data, "image/png") for i, data in enumerate(shots)]), "gallery")
            ok(post_json(url + "?wait=true&with_components=true", {
                "content": "Version 2.4.0 is out.",
                "components": [{"type": 1, "components": [
                    {"type": 2, "style": 5, "label": "Release Notes", "url": "https://example.com/notes", "emoji": {"name": "📝"}},
                    {"type": 2, "style": 5, "label": "Download", "url": "https://example.com/download"},
                ]}],
            }), "link buttons")
            report = b"All checks passed.\n"
            ok(post_files(url + "?wait=true&with_components=true", {
                "username": "Weekly Report",
                "flags": 32768,
                "components": [
                    {"type": 17, "accent_color": 0x5865F2, "components": [
                        {"type": 10, "content": "## Weekly Report\nEverything that happened in **nexa** this week."},
                        {"type": 9, "components": [{"type": 10, "content": "**42** pull requests merged\n**7** releases shipped"}], "accessory": {"type": 11, "media": {"url": "attachment://logo.png"}, "description": "Logo"}},
                        {"type": 14, "divider": True, "spacing": 1},
                        {"type": 12, "items": [{"media": {"url": "attachment://g1.png"}, "description": "Before"}, {"media": {"url": "attachment://g2.png"}, "description": "After"}]},
                        {"type": 13, "file": {"url": "attachment://report.txt"}},
                        {"type": 9, "components": [{"type": 10, "content": "Read the full report online."}], "accessory": {"type": 2, "style": 5, "label": "Open Report", "url": "https://example.com/report"}},
                    ]},
                    {"type": 10, "content": "-# Sent every Friday"},
                ],
            }, [("logo.png", logo, "image/png"), ("g1.png", shots[0], "image/png"), ("g2.png", shots[2], "image/png"), ("report.txt", report, "text/plain")]), "components v2")
            poll = ok(post_json(url + "?wait=true", {
                "username": "Team Lunch",
                "poll": {
                    "question": {"text": "Where should we eat on Friday?"},
                    "answers": [
                        {"poll_media": {"text": "Pizza place", "emoji": {"name": "🍕"}}},
                        {"poll_media": {"text": "Ramen bar", "emoji": {"name": "🍜"}}},
                        {"poll_media": {"text": "Salad shop", "emoji": {"name": "🥗"}}},
                    ],
                    "duration": 24,
                    "allow_multiselect": False,
                },
            }), "poll")
            gh = {
                "ref": "refs/heads/main",
                "compare": "https://github.com/example/nexa/compare/abc...def",
                "repository": {"name": "nexa", "full_name": "example/nexa", "html_url": "https://github.com/example/nexa"},
                "sender": {"login": "octocat", "html_url": "https://github.com/octocat", "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4"},
                "commits": [
                    {"id": "a1b2c3d4e5f6a7b8c9d0", "message": "Add webhooks", "url": "https://github.com/example/nexa/commit/a1b2c3d", "author": {"name": "Octo Cat", "username": "octocat"}},
                    {"id": "0f1e2d3c4b5a69788796", "message": "Translate the webhook strings", "url": "https://github.com/example/nexa/commit/0f1e2d3", "author": {"name": "Octo Cat", "username": "octocat"}},
                ],
            }
            ok(post_json(url + "/github?wait=true", gh, {"X-GitHub-Event": "push"}), "github push")
            ok(post_json(url + "/slack?wait=true", {
                "username": "Alerts",
                "text": "*Disk space* is low on `db-1`",
                "attachments": [{"color": "danger", "title": "db-1: 91% full", "title_link": "https://grafana.example.com/d/db", "text": "Free up space or grow the volume.", "fields": [{"title": "Host", "value": "db-1", "short": True}, {"title": "Used", "value": "91%", "short": True}], "footer": "Grafana"}],
            }), "slack")
            edited = ok(post_json(url + "?wait=true", {"content": "Deploying to production…", "username": "Deploy Bot"}), "to edit")
            ok(request("PATCH", f"{url}/messages/{edited['id']}", json.dumps({"content": "Deployed to production ✅", "embeds": [{"description": "Took 2 minutes.", "color": 0x57F287}]}).encode(), {"Content-Type": "application/json"}), "edit")
            ok(post_json(url + "?wait=true", {"content": "This one is read aloud.", "tts": True, "username": "Announcer"}), "tts")
            ok(post_json(url + "?wait=true", {"content": "A quiet one, with no notification.", "flags": 4096}), "silent")

            # a mistake is refused the way programs expect
            status, body = post_json(url, {"embeds": [{"title": "x" * 300}]})
            err = json.loads(body)
            assert status == 400 and err.get("code") == 50035 and "embeds" in json.dumps(err.get("errors")), (status, body)
            status, body = request("POST", url.rsplit("/", 1)[0] + "/wrongtoken", b"{}", {"Content-Type": "application/json"})
            assert status == 401 and json.loads(body).get("code") == 50027, (status, body)
            print("  errors look right; waited out", len(RATE_LIMITED), "rate limits")

            # alice reads them on the desktop
            a.goto(f"{srv.base}/channels/{server_id}/{general_id}", wait_until="networkidle")
            a.wait_for_selector("[data-id]:has-text('A quiet one')", timeout=20000)
            a.wait_for_timeout(1500)
            assert a.locator("[data-testid=webhook-tag]").count() >= 5, "webhook messages carry the tag"
            assert a.locator("[data-testid=rich-embed]").count() >= 4
            for label, text in [("hook-plain", "Deploy of"), ("hook-embed", "Build #1289 passed"), ("hook-gallery", "Nightly screenshots"), ("hook-buttons", "Version 2.4.0 is out."), ("hook-v2", "Weekly Report"), ("hook-poll", "Where should we eat"), ("hook-github", "new commit"), ("hook-slack", "db-1: 91% full"), ("hook-edit", "Deployed to production")]:
                row = a.locator(f"[data-id]:has-text('{text}')").last
                row.scroll_into_view_if_needed()
                a.wait_for_timeout(600)
                alice.shot(label)
            # the popout says what a webhook is
            a.locator("[data-id]:has-text('Build #1289 passed') button[data-webhook]").first.click()
            a.wait_for_timeout(400)
            alice.shot("hook-popout")
            a.keyboard.press("Escape")

            # bob, on his phone, votes in the poll
            b.goto(f"{srv.base}/channels/{server_id}/{general_id}", wait_until="networkidle")
            b.wait_for_selector("[data-id]:has-text('A quiet one')", timeout=20000)
            b.wait_for_timeout(1200)
            for label, text in [("hook-embed", "Build #1289 passed"), ("hook-gallery", "Nightly screenshots"), ("hook-v2", "Weekly Report"), ("hook-github", "new commit"), ("hook-slack", "db-1: 91% full")]:
                row = b.locator(f"[data-id]:has-text('{text}')").last
                row.scroll_into_view_if_needed()
                b.wait_for_timeout(600)
                bob.shot(label)
            prow = b.locator(f"[data-id='{poll['id']}']")
            prow.scroll_into_view_if_needed()
            bob.shot("hook-poll-before")
            prow.locator("text=Ramen bar").click()
            prow.locator("[data-testid=poll-vote]").click()
            b.wait_for_selector(f"[data-id='{poll['id']}'] >> text=Remove Vote", timeout=15000)
            b.wait_for_timeout(500)
            bob.shot("hook-poll-voted")
            # alice sees the vote arrive
            a.locator(f"[data-id='{poll['id']}']").scroll_into_view_if_needed()
            a.wait_for_selector(f"[data-id='{poll['id']}'] >> text=1 vote", timeout=15000)
            alice.shot("hook-poll-alice")

            # the Integrations page on a phone
            alice_phone = Session(browser, srv.base, "alice", out, viewport=(390, 844))
            alice_phone.login()
            ap = alice_phone.page
            ap.goto(f"{srv.base}/channels/{server_id}/{general_id}", wait_until="networkidle")
            ap.wait_for_timeout(1500)
            alice_phone.shot("phone-channel")
            ap.click("button[aria-label='Open Navigation']")
            ap.wait_for_timeout(500)
            ap.click("button:has-text('Nexa Dev')")
            ap.click("text=Server Settings")
            ap.wait_for_timeout(500)
            ap.click("[data-nav=integrations]")
            ap.wait_for_selector("[data-testid=webhook-card]", timeout=15000)
            ap.click("[data-testid=webhook-card] button[aria-expanded]")
            ap.wait_for_selector("[data-testid=webhook-name]", timeout=15000)
            ap.wait_for_timeout(400)
            alice_phone.shot("phone-integrations")
            ap.locator("[data-testid=webhook-copy]").scroll_into_view_if_needed()
            ap.wait_for_timeout(300)
            alice_phone.shot("phone-integrations-actions")
            ap.keyboard.press("Escape")
            ap.wait_for_timeout(400)

            # the audit log names what happened to the webhook
            a.click("button:has-text('Nexa Dev')")
            a.click("text=Server Settings")
            a.click("[data-nav=audit]")
            # (the action filter lists the same words, in options nobody sees)
            a.wait_for_selector("text=created the webhook >> visible=true", timeout=15000)
            a.wait_for_selector("text=updated the webhook >> visible=true", timeout=15000)
            a.wait_for_timeout(400)
            alice.shot("audit-log")
            a.keyboard.press("Escape")
            errors = alice.errors + bob.errors + alice_phone.errors
            # a picture from elsewhere that cannot be fetched from this machine is not the app's fault
            errors = [e for e in errors if "/media/proxy/" not in e]
            browser.close()
        if errors:
            print("page errors:", *errors[:20], sep="\n  ")
            raise SystemExit(1)
        print("webhooks: all good")
    finally:
        srv.stop()


if __name__ == "__main__":
    main()
