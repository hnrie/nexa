#!/usr/bin/env python3
"""End-to-end run: starts a throwaway chatd, registers two users in two browser
contexts and drives them through the core flows, taking screenshots along the way.

  PLAYWRIGHT_VENV=... python3 tools/e2e.py [--out tools/out] [--keep] [--headed]
"""
import argparse, os, shutil, signal, socket, struct, subprocess, sys, tempfile, time, zlib
from pathlib import Path

VENV = os.environ.get("PLAYWRIGHT_VENV")
if VENV and not sys.executable.startswith(VENV):
    os.execv(os.path.join(VENV, "bin", "python"), [os.path.join(VENV, "bin", "python"), *sys.argv])

from playwright.sync_api import sync_playwright, expect  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PASSWORD = "correct horse battery staple"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Server:
    def __init__(self, keep=False):
        self.dir = Path(tempfile.mkdtemp(prefix="chat-e2e-"))
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.keep = keep
        env = dict(os.environ, LISTEN=f"127.0.0.1:{self.port}", DATA_DIR=str(self.dir / "data"), WEB_DIST=str(ROOT / "web/dist"), PUBLIC_URL=self.base, LOG_LEVEL="warn")
        self.log = open(self.dir / "chatd.log", "w")
        self.proc = subprocess.Popen([str(ROOT / "bin/chatd")], env=env, stdout=self.log, stderr=subprocess.STDOUT, cwd=str(self.dir))
        for _ in range(50):
            try:
                import urllib.request
                urllib.request.urlopen(self.base + "/api/health", timeout=1)
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("chatd did not start; see " + str(self.dir / "chatd.log"))

    def stop(self):
        self.proc.send_signal(signal.SIGTERM)
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()
        if not self.keep:
            shutil.rmtree(self.dir, ignore_errors=True)


def png_bytes(w=64, h=64, rgb=(218, 62, 68)):
    """A tiny valid PNG without any imaging library."""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class Session:
    """One user in one browser context."""

    def __init__(self, browser, base, name, out, viewport=(1366, 768)):
        self.base, self.name, self.out = base, name, out
        w, h = viewport
        self.ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=w < 768, has_touch=w < 768)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(f"{name}: {e}"))
        self.page.on("console", lambda m: self.errors.append(f"{name}: {m.text}") if m.type == "error" else None)

    def shot(self, label):
        path = self.out / f"{label}-{self.name}-{self.page.viewport_size['width']}.png"
        self.page.screenshot(path=str(path))
        print("  wrote", path)

    def register(self, display=None):
        p = self.page
        p.goto(self.base + "/register", wait_until="networkidle")
        p.fill("input[autocomplete=username]", self.name)
        p.fill("input[autocomplete=nickname]", display or self.name.capitalize())
        pws = p.locator("input[type=password]")
        pws.nth(0).fill(PASSWORD)
        pws.nth(1).fill(PASSWORD)
        p.click("button[type=submit]")
        p.wait_for_selector("[data-testid=recovery-key]", timeout=60000)
        self.recovery = p.locator("[data-testid=recovery-key]").inner_text()
        assert len(self.recovery.replace("-", "")) == 64, self.recovery
        p.check("input[type=checkbox]")
        p.click("text=Continue to Evilion Chat")
        p.wait_for_url("**/channels/@me", timeout=30000)
        p.wait_for_selector("text=Friends", timeout=15000)

    def login(self):
        p = self.page
        p.goto(self.base + "/login", wait_until="networkidle")
        p.fill("input[autocomplete=username]", self.name)
        p.fill("input[type=password]", PASSWORD)
        p.click("button[type=submit]")
        p.wait_for_url("**/channels/@me", timeout=60000)

    def add_friend(self, username):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click("text=Add Friend")
        p.fill("input[aria-label=Username]", username)
        p.click("text=Send Friend Request")
        p.wait_for_selector("text=/Success|now friends/", timeout=15000)

    def accept_friend(self, display):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click("button:has-text('Pending')")
        row = p.locator(f"div:has(> div > span:has-text('{display}'))").first
        p.wait_for_selector("button[aria-label=Accept]", timeout=15000)
        p.click("button[aria-label=Accept]")
        p.click("button:has-text('All')")
        p.wait_for_selector(f"text={display}", timeout=15000)
        _ = row

    def open_dm_with(self, display):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click("button:has-text('All')")
        row = p.locator(f"[data-user='{display.lower()}'] button[aria-label=Message]").first
        row.wait_for(timeout=15000)
        row.click()
        p.wait_for_url("**/channels/@me/*", timeout=15000)

    def open_dm_from_sidebar(self, display):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click(f"button:has(span:text-is('{display}'))")
        p.wait_for_url("**/channels/@me/*", timeout=15000)

    def composer(self):
        return self.page.locator("textarea[aria-label^='Message']")

    def send(self, text):
        box = self.composer()
        box.wait_for(timeout=15000)
        box.fill(text)
        box.press("Enter")

    def wait_text(self, text, timeout=20000):
        self.page.wait_for_selector(f"text={text}", timeout=timeout)

    def message_row(self, text):
        return self.page.locator(f"[data-id]:has-text('{text}')").last


def server_flow(srv, alice, bob, phone):
    a, b = alice.page, bob.page
    # alice creates a server
    a.goto(srv.base + "/channels/@me", wait_until="networkidle")
    a.click("button[aria-label='Add a Server']")
    a.fill("[data-testid=server-name]", "Test Server")
    a.click("button:has-text('Create')")
    a.wait_for_url("**/channels/*/*", timeout=20000)
    a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
    alice.send("first message in general")
    a.wait_for_selector("[data-id]:has-text('first message in general')", timeout=20000)
    server_id = a.url.split("/channels/")[1].split("/")[0]
    # invite link carries the key fragment
    a.click("button[aria-label='Invite People']")
    link_box = a.locator("[data-testid=invite-link]")
    link_box.wait_for(timeout=15000)
    for _ in range(50):
        link = link_box.input_value()
        if "#k=" in link:
            break
        time.sleep(0.1)
    assert "#k=" in link, link
    a.keyboard.press("Escape")
    # bob joins through the link and can read the history immediately
    b.goto(link, wait_until="networkidle")
    b.wait_for_selector("text=Test Server", timeout=15000)
    bob.shot("invite")
    b.click("button:has-text('Accept Invite')")
    b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
    b.wait_for_selector("[data-id]:has-text('first message in general')", timeout=20000)
    a.wait_for_selector("[data-testid=member-list] [data-user]", timeout=15000)
    assert a.locator("[data-testid=member-list] [data-user]").count() == 2, "alice sees both members"
    bob.send("bob says hi in general")
    a.wait_for_selector("[data-id]:has-text('bob says hi in general')", timeout=20000)
    alice.shot("server")
    bob.shot("server")
    # a private channel: bob must not see it, and it encrypts under its own key
    a.click("button[aria-label='Create Channel']")
    a.fill("[data-testid=channel-name]", "staff")
    a.locator("input[role=switch]").check()
    a.click("button:has-text('Create Channel')")
    a.wait_for_selector("textarea[aria-label='Message #staff']", timeout=20000)
    alice.send("secret staff message")
    a.wait_for_selector("[data-id]:has-text('secret staff message')", timeout=20000)
    time.sleep(0.5)
    assert b.locator("[data-channel] >> text=staff").count() == 0, "bob must not see the private channel"
    # a role that cannot send messages, assigned to bob
    a.click("button:has-text('Test Server')")
    a.click("text=Server Settings")
    a.click("[data-nav=roles]")
    a.click("[data-testid=create-role]")
    a.fill("[data-testid=role-name]", "Muted")
    a.click("[data-testid=save]")
    a.wait_for_selector("text=Role saved.", timeout=15000)
    a.click("[data-nav=members]")
    b_row = a.locator(f"[data-member]:has-text('Bob')")
    b_row.locator("button[aria-label='Edit roles']").click()
    a.locator("label:has-text('Muted') input").check()
    time.sleep(0.5)
    a.keyboard.press("Escape")
    a.keyboard.press("Escape")
    # deny Send Messages for @everyone in general (the role and everyone are both muted for bob)
    general = a.locator("[data-channel] >> text=general").first
    general.hover()
    a.locator("[data-channel]:has-text('general') button[aria-label='Edit Channel']").first.click()
    a.click("[data-nav=permissions]")
    a.locator("[data-perm=SEND_MESSAGES] button[aria-label=Deny]").click()
    a.click("[data-testid=save]")
    a.wait_for_selector("text=Permissions saved.", timeout=15000)
    a.keyboard.press("Escape")
    b.wait_for_selector("[data-testid=composer-locked]", timeout=20000)
    bob.shot("server-locked")
    # alice (owner) can still send in #general
    a.locator("[data-channel]:has-text('general') button").first.click()
    a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
    # drag reorder: move #staff above #general inside Text Channels
    staff_row = a.locator("[data-channel]:has-text('staff')").first
    general_row = a.locator("[data-channel]:has-text('general')").first
    staff_row.drag_to(general_row, target_position={"x": 40, "y": 4})
    time.sleep(1.0)
    names = [t.strip() for t in a.locator("[data-channel] span:nth-child(2)").all_inner_texts()]
    assert names.index("staff") < names.index("general"), names
    a.reload(wait_until="networkidle")
    a.wait_for_selector("[data-channel]", timeout=15000)
    names = [t.strip() for t in a.locator("[data-channel] span:nth-child(2)").all_inner_texts()]
    assert names.index("staff") < names.index("general"), "order persists after reload: " + str(names)
    alice.shot("server-reordered")
    # kick bob: he loses the server and the key rotates
    a.click("button:has-text('Test Server')")
    a.click("text=Server Settings")
    a.click("[data-nav=members]")
    a.locator("[data-member]:has-text('Bob') button[aria-label=Kick]").click()
    a.click("button:has-text('Kick'):not(:has-text('Members'))")
    b.wait_for_url("**/channels/@me**", timeout=20000)
    a.click("[data-nav=encryption]")
    a.wait_for_selector("text=/Key epoch [1-9]/", timeout=20000)
    alice.shot("server-encryption")
    a.keyboard.press("Escape")
    # carol on the phone opens the server through the drawer
    phone.page.goto(link, wait_until="networkidle")
    phone.page.click("button:has-text('Accept Invite')")
    phone.page.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
    phone.page.wait_for_selector("[data-id]:has-text('first message in general')", timeout=20000)
    phone.shot("server")
    phone.page.click("button[aria-label='Open navigation']")
    time.sleep(0.4)
    phone.shot("server-drawer")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tools/out"))
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    srv = Server(keep=args.keep)
    ok = False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            alice = Session(browser, srv.base, "alice", out)
            bob = Session(browser, srv.base, "bob", out)
            phone = Session(browser, srv.base, "carol", out, viewport=(390, 844))
            print("register")
            alice.register("Alice")
            bob.register("Bob")
            phone.register("Carol")
            print("friends")
            bob.add_friend("alice")
            alice.accept_friend("Bob")
            phone.add_friend("alice")
            alice.accept_friend("Carol")
            alice.shot("friends-all")
            print("dm + messages")
            alice.open_dm_with("Bob")
            alice.send("hello **bob** :) here is `code` and a [link](https://example.com)")
            alice.page.wait_for_selector(".md-paragraph strong:text-is('bob')", timeout=20000)
            bob.open_dm_from_sidebar("Alice")
            bob.page.wait_for_selector(".md-paragraph strong:text-is('bob')", timeout=20000)
            assert bob.page.locator(".md-inline-code:text-is('code')").count() == 1
            # bob reacts and replies
            row = bob.message_row("hello")
            row.hover()
            row.locator("button[aria-label='Add Reaction']").click()
            bob.page.fill("input[aria-label='Search emoji']", "thumbs up")
            bob.page.locator("[role=dialog][aria-label='Expression picker'] button[data-emoji]").first.click()
            alice.page.wait_for_selector("[data-me=false]:has-text('1')", timeout=20000)
            row = bob.message_row("hello")
            row.hover()
            row.locator("button[aria-label='Reply']").click()
            bob.send("hi alice, replying")
            alice.wait_text("hi alice, replying")
            assert alice.page.locator("[data-id]:has-text('replying') >> text=Alice").count() >= 1, "reply preview should name Alice"
            # alice edits her first message with ArrowUp
            alice.composer().press("ArrowUp")
            edit = alice.page.locator("textarea").first
            edit.wait_for(timeout=10000)
            edit.press("End")
            edit.type(" (and edited)")
            edit.press("Enter")
            bob.wait_text("(and edited)")
            bob.page.wait_for_selector("text=(edited)", timeout=20000)
            # alice uploads an encrypted image
            alice.page.set_input_files("input[type=file]", {"name": "pic.png", "mimeType": "image/png", "buffer": png_bytes()})
            alice.page.wait_for_selector("text=pic.png", timeout=10000)
            alice.composer().press("Enter")
            bob.page.wait_for_selector("img[alt='pic.png']", timeout=30000)
            alice.page.wait_for_selector("img[alt='pic.png']", timeout=30000)
            alice.shot("dm")
            bob.shot("dm")
            # carol on a phone opens a DM with alice and sends from mobile
            phone.open_dm_with("Alice")
            phone.send("yo from the phone")
            phone.page.locator("button[aria-label='Send message']").click()
            phone.page.wait_for_selector("text=yo from the phone", timeout=20000)
            alice.open_dm_from_sidebar("Carol")
            alice.page.wait_for_selector("text=yo from the phone", timeout=20000)
            phone.shot("dm")
            phone.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            phone.shot("friends")
            phone.page.click("button[aria-label='Open navigation']")
            time.sleep(0.4)
            phone.shot("drawer")
            print("servers")
            server_flow(srv, alice, bob, phone)
            errors = alice.errors + bob.errors + phone.errors
            if errors:
                print("browser errors:\n  " + "\n  ".join(errors))
            ok = not errors
            browser.close()
    finally:
        srv.stop()
    if args.keep:
        print("kept data dir:", srv.dir)
    print("E2E", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
