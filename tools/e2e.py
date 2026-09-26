#!/usr/bin/env python3
"""End-to-end run: starts a throwaway chatd, registers two users in two browser
contexts and drives them through the core flows, taking screenshots along the way.

  PLAYWRIGHT_VENV=... python3 tools/e2e.py [--out tools/out] [--keep] [--headed]
"""
import argparse, json, os, shutil, signal, socket, struct, subprocess, sys, tempfile, time, zlib
from pathlib import Path

VENV = os.environ.get("PLAYWRIGHT_VENV")
# compare resolved paths: a relative PLAYWRIGHT_VENV never matches sys.prefix
# as written, and re-executing on every start would loop forever
if VENV and os.path.realpath(sys.prefix) != os.path.realpath(VENV):
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
        # STUN_URLS=none keeps ICE to host candidates: both browsers are on this
        # machine, and a public STUN server that times out only adds flakiness.
        # E2E_WEB_DIST and E2E_CHATD test a build without first putting it
        # where the instance running for real on this machine serves from.
        web_dist = os.environ.get("E2E_WEB_DIST") or str(ROOT / "web/dist")
        chatd = os.environ.get("E2E_CHATD") or str(ROOT / "bin/chatd")
        # GUEST_LINKS_P2P: calls here go peer to peer, where guest links are off unless asked for
        env = dict(os.environ, LISTEN=f"127.0.0.1:{self.port}", DATA_DIR=str(self.dir / "data"), WEB_DIST=web_dist, PUBLIC_URL=self.base, LOG_LEVEL="warn", STUN_URLS=os.environ.get("STUN_URLS", "none"), MAX_UPLOAD_BYTES=str(1 << 30), GUEST_LINKS_P2P="1")
        self.log = open(self.dir / "chatd.log", "w")
        self.proc = subprocess.Popen([chatd], env=env, stdout=self.log, stderr=subprocess.STDOUT, cwd=str(self.dir))
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

    def __init__(self, browser, base, name, out, viewport=(1366, 768), service_workers="allow", record=None):
        self.base, self.name, self.out = base, name, out
        w, h = viewport
        # record is a directory: the context films itself into it, for the
        # loops the front page plays (tools/home_gifs.py)
        film = {"record_video_dir": record, "record_video_size": {"width": w, "height": h}} if record else {}
        self.ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=w < 768, has_touch=w < 768, permissions=["microphone", "camera"], service_workers=service_workers, **film)
        self.page = self.ctx.new_page()
        self.errors = []
        self.trace = []
        self.page.on("pageerror", lambda e: self.errors.append(f"{name}: {e}"))
        # a bare "failed to load resource" says nothing; keep the address too
        self.page.on("console", lambda m: self.errors.append(f"{name}: {m.text}") if m.type == "error" and "status of 4" not in m.text and "status of 5" not in m.text else None)
        self.page.on("response", lambda r: self.errors.append(f"{name}: HTTP {r.status} {r.url}") if r.status >= 400 and "/api/v1/" not in r.url.split("?")[0] or (r.status >= 500) else None)
        self.page.on("console", lambda m: self.trace.append(f"{name} {m.type}: {m.text[:300]}") if "voice" in m.text else None)

    def shot(self, label):
        path = self.out / f"{label}-{self.name}-{self.page.viewport_size['width']}.png"
        time.sleep(0.25)  # let enter animations finish
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
        p.click("text=Continue to nexa")
        p.wait_for_url("**/channels/@me", timeout=30000)
        self.agree_terms()
        # an account made after the latest release has no What's New to see
        Session.whats_new_read.add((self.base, self.name))
        p.wait_for_selector("text=Friends", timeout=15000)

    def agree_terms(self):
        """Gets past the Terms dialog every account sees until it agrees (on this device)."""
        p = self.page
        try:
            p.wait_for_selector("[data-testid=terms-gate]", timeout=5000)
        except Exception:
            return
        p.check("[data-testid=terms-check]")
        p.click("[data-testid=terms-agree]")
        p.wait_for_selector("[data-testid=terms-gate]", state="detached", timeout=5000)

    # accounts whose What's New has been read on each server, in this run
    whats_new_read = set()

    def dismiss_whats_new(self, timeout=6000):
        """Closes What's New, which an account from before the latest release sees once (synced, so once per run)."""
        key = (self.base, self.name)
        if key in Session.whats_new_read:
            return
        p = self.page
        try:
            p.wait_for_selector("[data-testid=whats-new-done]", timeout=timeout)
        except Exception:
            return
        p.click("[data-testid=whats-new-done]")
        p.wait_for_selector("[data-testid=whats-new]", state="detached", timeout=5000)
        # long enough for the settings save that remembers it, so the next sign-in skips it
        p.wait_for_timeout(1500)
        Session.whats_new_read.add(key)

    def login(self):
        p = self.page
        p.goto(self.base + "/login", wait_until="networkidle")
        p.fill("input[autocomplete=username]", self.name)
        p.fill("input[type=password]", PASSWORD)
        p.click("button[type=submit]")
        p.wait_for_url("**/channels/@me", timeout=60000)
        self.agree_terms()
        self.dismiss_whats_new()

    def logout(self):
        p = self.page
        if p.locator("[role=dialog][aria-label='User Settings']").count() == 0:
            p.click("button[aria-label='User Settings']")
        p.click("nav button:has-text('Log Out')")
        # it asks first, in a dialog of its own above the settings
        p.locator("[role=dialog] button:has-text('Log Out')").last.click()
        p.wait_for_url("**/login**", timeout=30000)

    def open_settings(self, nav):
        p = self.page
        if p.locator("[role=dialog][aria-label='User Settings']").count() == 0:
            p.click("button[aria-label='User Settings']")
        p.click(f"[data-nav={nav}]")
        p.wait_for_timeout(300)

    def close_settings(self):
        p = self.page
        for _ in range(3):
            if p.locator("[role=dialog][aria-label='User Settings']").count() == 0:
                return
            p.keyboard.press("Escape")
            p.wait_for_timeout(250)

    def add_friend(self, username):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click("text=Add Friend")
        p.fill("input[aria-label=Username]", username)
        p.click("text=Send Friend Request")
        p.wait_for_selector("text=/was sent|now friends/", timeout=15000)

    def accept_friend(self, display):
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        p.click("button:has-text('Pending')")
        row = p.locator(f"div:has(> div > span:has-text('{display}'))").first
        p.wait_for_selector("[data-testid=friend-accept]", timeout=15000)
        p.click("[data-testid=friend-accept]")
        # accepting opens the new conversation, so come back for the list
        for _ in range(20):
            p.wait_for_timeout(300)
            if "/channels/@me/" in p.url:
                break
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
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

    def open_dm_from_sidebar(self, *names):
        """Opens a DM by any of the names it may show under (a nickname wins)."""
        p = self.page
        p.goto(self.base + "/channels/@me", wait_until="networkidle")
        sel = ", ".join(f"button:has(span:text-is('{n}'))" for n in names)
        p.locator(sel).first.click()
        p.wait_for_url("**/channels/@me/*", timeout=15000)

    def composer(self):
        return self.page.locator("textarea[aria-label^='Message']")

    def send(self, text):
        box = self.composer()
        box.wait_for(timeout=15000)
        box.fill(text)
        # a phone keyboard's Enter makes a new line, so it has a send button
        if self.page.viewport_size["width"] < 768:
            self.page.click("button[aria-label='Send message']")
        else:
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
    b.click("[data-testid=invite-join]")
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
    phone.page.click("[data-testid=invite-join]")
    phone.page.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
    phone.page.wait_for_selector("[data-id]:has-text('first message in general')", timeout=20000)
    phone.shot("server")
    phone.page.click("button[aria-label='Open navigation']")
    time.sleep(0.4)
    phone.shot("server-drawer")
    return server_id, link


def expressions_flow(srv, alice, bob, server_id, link):
    a, b = alice.page, bob.page
    # bob was kicked (not banned): he rejoins through the same link
    b.goto(link, wait_until="networkidle")
    b.click("[data-testid=invite-join]")
    b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
    # alice uploads a custom emoji in server settings
    a.click("button:has-text('Test Server')")
    a.click("text=Server Settings")
    a.click("[data-nav=emoji]")
    a.set_input_files("[data-testid=emoji-file]", {"name": "party.png", "mimeType": "image/png", "buffer": png_bytes(64, 64, (80, 200, 120))})
    a.wait_for_selector("text=:party:", timeout=20000)
    alice.shot("server-emoji")
    a.keyboard.press("Escape")
    # she sends it from the picker; bob sees the image
    a.locator("[data-channel]:has-text('general') button").first.click()
    a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
    a.click("button[aria-label='Select emoji']")
    a.fill("input[aria-label='Search emoji']", "party")
    a.locator("[role=dialog][aria-label='Expression picker'] button[data-custom]").first.click()
    a.keyboard.press("Escape")
    alice.composer().press("End")
    alice.composer().type(" custom emoji test")
    alice.composer().press("Enter")
    b.wait_for_selector("[data-id]:has-text('custom emoji test') img.md-emoji[alt=':party:']", timeout=20000)
    # :party autocomplete offers the custom emoji
    alice.composer().type(":par")
    a.wait_for_selector("[role=listbox] >> text=:party:", timeout=10000)
    a.keyboard.press("Escape")
    alice.composer().fill("")
    # a personal sticker pack, created in user settings, with one sticker
    a.click("button[aria-label='User Settings']")
    a.click("[data-nav=stickers], button:has-text('Sticker Packs')")
    # the app asks for the name in its own dialog (the desktop app has no window.prompt)
    a.click("[data-testid=create-pack]")
    a.fill("[data-testid=create-pack-name]", "Test pack")
    a.keyboard.press("Enter")
    a.wait_for_selector("[data-testid=pack-name]", timeout=15000)
    a.set_input_files("[data-testid=sticker-file]", {"name": "wave.png", "mimeType": "image/png", "buffer": png_bytes(96, 96, (250, 180, 60))})
    a.wait_for_selector("[data-testid=sticker-name]", timeout=10000)
    a.fill("[data-testid=sticker-name]", "Wave")
    a.click("[data-testid=upload-stickers]")
    try:
        a.wait_for_selector("text=Sticker added.", timeout=20000)
    except Exception:
        alice.shot("sticker-upload-failed")
        print("toasts:", a.locator("[role=status], [class*=toast]").all_inner_texts())
        print("browser errors:", alice.errors)
        raise
    alice.shot("sticker-pack")
    a.keyboard.press("Escape")
    # send the sticker from the picker
    a.click("button[aria-label='Select emoji']")
    a.click("[role=dialog][aria-label='Expression picker'] button:has-text('Stickers')")
    a.locator("[role=dialog][aria-label='Expression picker'] button[data-sticker]").first.click()
    b.wait_for_selector("[data-id] img[alt='Wave']", timeout=20000)
    a.wait_for_selector("[data-id] img[alt='Wave']", timeout=20000)
    alice.shot("sticker-sent")
    # the picker shows GIF search is off (no Tenor key) but favourites still exist
    a.click("button[aria-label='Select emoji']")
    a.click("[role=dialog][aria-label='Expression picker'] button:has-text('GIFs')")
    a.wait_for_selector("text=/GIF search is off|No favorite GIFs/", timeout=10000)
    alice.shot("gif-tab")
    a.keyboard.press("Escape")


def voice_flow(srv, alice, bob, server_id):
    a, b = alice.page, bob.page
    # the mesh reports trouble through console.warn, which the session filter drops
    chatter = []
    frames = []

    def watch_ws(ws, name):
        ws.on("framesent", lambda payload: frames.append(f"{name} -> {payload[:220]}") if "voice" in payload else None)
        ws.on("framereceived", lambda payload: frames.append(f"{name} <- {payload[:220]}") if "voice" in payload else None)

    for sess in (alice, bob):
        sess.page.on("console", lambda m, n=sess.name: chatter.append(f"{n} {m.type}: {m.text[:300]}"))
        sess.page.on("websocket", lambda ws, n=sess.name: watch_ws(ws, n))
    alice_id = a.evaluate("() => JSON.parse(localStorage.getItem('ec:me') || 'null')")  # may be null; not needed
    _ = alice_id
    # both join the server's voice channel from the sidebar
    for sess in (alice, bob):
        sess.page.goto(srv.base + "/channels/" + server_id, wait_until="networkidle")
        sess.page.locator("[data-channel]:has(span:text-is('General')) button").first.click()
        sess.page.wait_for_selector("[data-testid=voice-status]", timeout=20000)
    a.wait_for_selector("[data-testid=voice-participants] [data-user]", timeout=20000)
    for sess in (alice, bob):
        sess.page.wait_for_function("() => document.querySelectorAll('[data-testid=voice-participants] [data-user]').length === 2", timeout=20000)
    # peers connect directly (fake devices, loopback ICE). Your own tile counts
    # as connected from the start, so wait for both rather than for any one.
    for sess in (alice, bob):
        try:
            sess.page.wait_for_function("() => document.querySelectorAll('[data-peer-state=connected][data-user]').length === 2", timeout=60000)
        except Exception:
            for other in (alice, bob):
                tiles = other.page.evaluate("() => Array.from(document.querySelectorAll('[data-peer-state]')).map(e => e.getAttribute('data-user') + ':' + e.getAttribute('data-peer-state') + ':' + e.getAttribute('data-kind'))")
                members = other.page.evaluate("() => Array.from(document.querySelectorAll('[data-testid=voice-participants] [data-user]')).map(e => e.getAttribute('data-user'))")
                toasts = other.page.evaluate("() => Array.from(document.querySelectorAll('[role=status], [class*=toast]')).map(e => e.textContent)")
                mic = other.page.evaluate("""async () => {
                    try {
                        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const n = st.getAudioTracks().length;
                        st.getTracks().forEach((t) => t.stop());
                        return 'ok:' + n;
                    } catch (e) { return 'failed:' + e.name + ':' + e.message; }
                }""")
                print(f"  {other.name}: tiles={tiles} participants={members} toasts={toasts} mic={mic}")
                other.shot("voice-stuck")
            print("  console:\n    " + "\n    ".join((alice.trace + bob.trace)[-60:]))
            print("  frames:\n    " + "\n    ".join(frames[-40:]))
            raise
    alice.shot("voice-room")
    # mute shows up on the other side
    a.click("[data-testid=voice-mute]")
    b.wait_for_selector("[data-testid=voice-participants] [data-user] svg.lucide-mic-off", timeout=15000)
    a.click("[data-testid=voice-mute]")
    # alice leaves: bob's list shrinks to one
    a.click("[data-testid=voice-leave]")
    b.wait_for_function("() => document.querySelectorAll('[data-testid=voice-participants] [data-user]').length === 1", timeout=20000)
    b.click("[data-testid=voice-status-leave]")
    a.wait_for_function("() => !document.querySelector('[data-testid=voice-status]')", timeout=20000)
    # DM call: alice rings bob, bob accepts, both connect
    alice.open_dm_from_sidebar("Bobby", "Bob")
    a.click("[data-testid=start-call]")
    a.wait_for_selector("[data-testid=voice-status]", timeout=20000)
    b.wait_for_selector("[data-testid=incoming-call]", timeout=20000)
    bob.shot("incoming-call")
    b.click("[data-testid=accept-call]")
    b.wait_for_selector("[data-testid=voice-status]", timeout=20000)
    for sess in (alice, bob):
        sess.page.wait_for_selector("[data-peer-state=connected][data-user]", timeout=40000)
    alice.shot("dm-call")
    guest_call(alice, bob)
    b.click("[data-testid=voice-status-leave]")
    a.click("[data-testid=voice-status-leave]")
    a.wait_for_function("() => !document.querySelector('[data-testid=voice-status]')", timeout=20000)


def guest_call(alice, bob):
    """A guest with no account joins alice and bob's DM call through a link, reaches nothing else, and is removed."""
    a, b = alice.page, bob.page
    a.click("[data-testid=invite-guests]")
    box = a.locator("[data-testid=guest-link]")
    box.wait_for(timeout=15000)
    link = ""
    for _ in range(100):
        link = box.input_value()
        if "#k=" in link:
            break
        time.sleep(0.1)
    assert "/call/" in link and "#k=" in link, f"guest link: {link}"
    a.keyboard.press("Escape")
    gctx = a.context.browser.new_context(permissions=["microphone", "camera"])
    g = gctx.new_page()
    try:
        g.goto(link, wait_until="networkidle")
        g.fill("[data-testid=guest-name]", "Visitor")
        g.click("[data-testid=guest-join]")
        g.wait_for_selector("[data-testid=guest-call]", timeout=30000)
        g.wait_for_function("() => document.querySelectorAll('[data-peer-state=connected][data-user]').length === 3", timeout=60000)
        code = link.split("/call/")[1].split("#")[0]
        stay = json.loads(g.evaluate(f"() => sessionStorage.getItem('ec.guest.{code}')"))
        gid = stay["guest"]["id"]
        for path in ("/users/@me", "/users/@me/channels", "/users/@me/relationships"):
            st = g.evaluate("async ([p, t]) => (await fetch('/api/v1' + p, { headers: { Authorization: 'Bearer ' + t } })).status", [path, stay["token"]])
            assert st == 401, f"a guest reached {path}: {st}"
        # The key names the slot rather than what is in it, so a guest with a
        # camera on is still `:camera` (VoiceView.tsx:330).
        b.wait_for_selector(f"[data-tile='{gid}:camera'] >> text=Guest", timeout=20000)
        alice.shot("dm-call-guest")
        a.locator(f"[data-tile='{gid}:camera']").click(button="right")
        a.click("text=Remove From Call")
        g.wait_for_selector("text=You were removed from the call.", timeout=15000)
        b.wait_for_selector(f"[data-tile='{gid}:camera']", state="detached", timeout=15000)
    finally:
        gctx.close()


def polish_flow(srv, alice, bob, server_id):
    a = alice.page
    # search the decrypted history of the server
    a.goto(srv.base + "/channels/" + server_id, wait_until="networkidle")
    a.locator("[data-channel]:has(span:text-is('general')) button").first.click()
    a.wait_for_selector("textarea[aria-label='Message #general']", timeout=15000)
    a.fill("[data-testid=search-input]", "first message")
    a.wait_for_selector("[data-testid=search-panel] [data-result]", timeout=15000)
    assert a.locator("[data-testid=search-panel] mark").count() >= 1, "search highlights the match"
    alice.shot("search")
    a.fill("[data-testid=search-input]", "from:bob hi")
    a.wait_for_selector("[data-testid=search-panel] [data-result]", timeout=15000)
    a.fill("[data-testid=search-input]", "zzzz-nothing-matches")
    a.wait_for_selector("text=No results in the", timeout=15000)
    a.click("[data-testid=search-panel] button[aria-label='Close search']")
    # the first account is the instance admin
    a.click("button[aria-label='User Settings']")
    a.click("[data-nav=admin]")
    a.wait_for_selector("text=Instance Admin", timeout=15000)
    a.wait_for_selector("text=Registration", timeout=15000)
    alice.shot("admin")
    # flip registration to closed and back
    a.locator("label:has-text('Closed') input").check()
    time.sleep(0.5)
    a.locator("label:has-text('Open') input").check()
    time.sleep(0.5)
    # bob is not an admin
    b = bob.page
    b.goto(srv.base + "/channels/@me", wait_until="networkidle")
    b.click("button[aria-label='User Settings']")
    assert b.locator("[data-nav=admin]").count() == 0, "non-admins have no admin page"
    b.keyboard.press("Escape")
    # data export downloads a zip
    a.click("[data-nav=privacy], button:has-text('Privacy & Safety')")
    a.wait_for_selector("[data-testid=export-data]", timeout=15000)
    with a.expect_download(timeout=60000) as dl:
        a.click("[data-testid=export-data]")
    path = dl.value.path()
    size = os.path.getsize(path)
    assert size > 200, f"export zip is tiny: {size}"
    with open(path, "rb") as f:
        head = f.read(4)
    assert head == b"PK\x03\x04", head
    print("  export zip:", size, "bytes")
    a.keyboard.press("Escape")
    # friend nickname + note on bob's profile
    alice.open_dm_from_sidebar("Bobby", "Bob")
    a.locator("[data-author]:text-is('Bob')").first.click()
    # the nickname is in the profile's menu and the note behind the icon by the name, as in Discord
    a.wait_for_selector("[data-testid=profile-modal] [data-testid=profile-more]", timeout=15000)
    a.click("[data-testid=profile-modal] [data-testid=profile-more]")
    a.click("text=Add Friend Nickname")
    a.fill("[data-testid=prompt-nickname]", "Bobby")
    a.click("[data-testid=prompt-confirm]")
    a.wait_for_selector("[data-testid=profile-modal] h2:text-is('Bobby')", timeout=15000)
    a.click("[data-testid=profile-modal] [data-testid=profile-note-toggle]")
    a.fill("textarea[aria-label=Note]", "met at the thing")
    time.sleep(0.6)
    alice.shot("profile-note")
    a.keyboard.press("Escape")


def groups_flow(srv, alice, bob, phone):
    a, b, c = alice.page, bob.page, phone.page
    # alice starts a group with bob, then invites carol with a link
    a.goto(srv.base + "/channels/@me", wait_until="networkidle")
    a.click("button[aria-label='Create DM']")
    a.locator("label:has-text('Bob') input").check()
    a.click("button:has-text('Create DM'), button:has-text('Create group')")
    a.wait_for_url("**/channels/@me/*", timeout=20000)
    a.wait_for_selector("textarea", timeout=15000)
    group_url = a.url
    alice.send("group chat works")
    a.wait_for_selector("[data-id]:has-text('group chat works')", timeout=20000)
    # a group of two is still a dm here, so add carol to force a group, then invite by link
    a.click("button[aria-label='Add friends']")
    modal = a.locator("[role=dialog]")
    if modal.locator("[data-testid=group-invite-link]").count() == 0:
        # it was a 1:1 dm: add carol to promote it to a group
        a.locator("label:has-text('Carol') input").check()
        a.click("button:has-text('Add to group'), button:has-text('Create group')")
        a.wait_for_timeout(1500)
        a.click("button[aria-label='Add friends']")
    link_box = a.locator("[data-testid=group-invite-link]")
    link_box.wait_for(timeout=20000)
    for _ in range(50):
        link = link_box.input_value()
        if "/invite/" in link:
            break
        time.sleep(0.1)
    assert "/invite/" in link, link
    a.keyboard.press("Escape")
    alice.shot("group-invite")
    # bob closes the DM with alice; it disappears from his sidebar
    b.goto(srv.base + "/channels/@me", wait_until="networkidle")
    before = b.locator("[data-channel]").count()
    b.locator("[data-channel]:has(span:text-is('Alice'))").first.click(button="right")
    b.wait_for_selector("text=Close DM", timeout=10000)
    b.click("text=Close DM")
    b.wait_for_function(f"() => document.querySelectorAll('[data-channel]').length === {before - 1}", timeout=15000)
    bob.shot("dm-closed")
    # alice messaging him brings it back
    a.goto(group_url, wait_until="networkidle")
    alice.open_dm_from_sidebar("Bobby", "Bob")
    alice.send("knock knock")
    b.wait_for_function(f"() => document.querySelectorAll('[data-channel]').length === {before}", timeout=20000)
    # an emoji pack in user settings, usable straight away
    a.click("button[aria-label='User Settings']")
    a.click("[data-nav=stickers]")
    a.click("[data-nav=packs-emoji]")
    a.click("[data-testid=create-pack]")
    a.fill("[data-testid=create-pack-name]", "My emoji")
    a.keyboard.press("Enter")
    a.wait_for_selector("[data-testid=pack-name]", timeout=15000)
    a.set_input_files("[data-testid=sticker-file]", {"name": "blobby.png", "mimeType": "image/png", "buffer": png_bytes(64, 64, (120, 90, 240))})
    a.wait_for_selector("[data-testid=sticker-name]", timeout=10000)
    a.fill("[data-testid=sticker-name]", "blobby")
    a.click("[data-testid=upload-stickers]")
    a.wait_for_selector("text=Emoji added.", timeout=20000)
    alice.shot("emoji-pack")
    a.keyboard.press("Escape")
    # it shows up in the picker and sends
    a.click("button[aria-label='Select emoji']")
    a.fill("input[aria-label='Search emoji']", "blobby")
    a.locator("[role=dialog][aria-label='Expression picker'] button[data-pack-emoji]").first.click()
    a.keyboard.press("Escape")
    alice.composer().press("End")
    alice.composer().press("Enter")
    try:
        a.wait_for_selector("[data-id] img.md-emoji[alt=':blobby:']", timeout=20000)
    except Exception:
        alice.shot("pack-emoji-failed")
        print("composer:", a.locator("textarea[aria-label^='Message']").input_value())
        print("last message:", a.locator("[data-id]").last.inner_text()[:120])
        raise
    alice.shot("pack-emoji-sent")


def sha256_file(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def random_file(path, size):
    with open(path, "wb") as f:
        left = size
        while left:
            n = min(left, 1 << 20)
            f.write(os.urandom(n))
            left -= n
    return sha256_file(path)


def files_flow(srv, alice, bob, browser, out):
    """Big files: one request until a file needs more, pieces above that,
    streamed to disk on the way down, and big media left alone until asked for."""
    mib = 1024 * 1024
    small, big, clip = srv.dir / "small.bin", srv.dir / "big.bin", srv.dir / "clip.mp4"
    small_sum = random_file(small, 5 * mib)
    big_sum = random_file(big, 100 * mib)
    random_file(clip, 30 * mib)

    sent = []
    alice.page.on("request", lambda r: sent.append((r.method, r.url.split("?")[0])) if "/uploads" in r.url or "/attachments" in r.url else None)
    # an earlier flow may have given Bob a friend nickname
    alice.open_dm_from_sidebar("Bobby", "Bob")
    for path in (small, big, clip):
        alice.page.set_input_files("input[type=file]", str(path))
        # the staged card, not a toast that happens to name the file
        alice.page.wait_for_selector(f"[title='{path.name}']", timeout=10000)
        alice.composer().press("Enter")
        # The message is in the chat at once, with its upload's progress; this
        # waits for the message itself, sent. A big video shows only its load
        # button, which does not name it.
        shown = "[data-id][data-pending='false'] button:has-text('Load video')" if path == clip else f"[data-id][data-pending='false']:has-text('{path.name}')"
        alice.page.wait_for_selector(shown, timeout=180000)
    singles = [u for m, u in sent if m == "POST" and u.endswith("/attachments")]
    pieces = [u for m, u in sent if m == "PATCH"]
    assert len(singles) == 2, f"5 MB and 30 MB files should each be one request: {sent}"
    assert len(pieces) == 4, f"100 MB should go up in four 32 MB pieces: {sent}"

    fetched = []
    bob.page.on("request", lambda r: fetched.append(r.url) if "/media/attachments/" in r.url or "/__download/" in r.url else None)
    bob.open_dm_from_sidebar("Alice")
    for path in (small, big):
        bob.page.wait_for_selector(f"[data-id]:has-text('{path.name}')", timeout=30000)
    load = bob.page.locator("[data-id] button:has-text('Load video')")
    load.wait_for(timeout=30000)
    time.sleep(2)
    # only pic.png from earlier may have come down by itself
    assert len({u for u in fetched if "/media/attachments/" in u}) <= 1, f"nothing big should load by itself: {fetched}"
    bob.shot("files")

    ready = "navigator.serviceWorker.getRegistration('/__download/').then(r => !!(r && r.scope.endsWith('/__download/') && r.active))"
    for _ in range(50):
        if bob.page.evaluate(ready):
            break
        time.sleep(0.2)
    else:
        raise AssertionError("the download worker never started")
    started = time.time()
    with bob.page.expect_download(timeout=120000) as info:
        bob.page.locator("[data-id]:has-text('big.bin') button[aria-label^='Download']").click()
    dl = info.value
    assert dl.suggested_filename == "big.bin", dl.suggested_filename
    assert sha256_file(dl.path()) == big_sum, "streamed download differs from what was sent"
    assert any("/__download/" in u for u in fetched), f"100 MB should stream through the worker: {fetched}"
    print(f"  100 MB streamed down and matched in {time.time() - started:.1f}s")

    with bob.page.expect_download(timeout=60000) as info:
        bob.page.locator("[data-id]:has-text('small.bin') button[aria-label^='Download']").click()
    assert sha256_file(info.value.path()) == small_sum, "small download differs from what was sent"

    before = len(fetched)
    load.click()
    for _ in range(50):
        if len(fetched) > before:
            break
        time.sleep(0.2)
    else:
        raise AssertionError("the video should load once asked for")
    bob.page.wait_for_selector("[data-id] video", timeout=60000)

    # without a service worker the page saves it itself
    plain = Session(browser, srv.base, "bob", out, service_workers="block")
    plain.login()
    plain.open_dm_from_sidebar("Alice")
    with plain.page.expect_download(timeout=120000) as info:
        plain.page.locator("[data-id]:has-text('big.bin') button[aria-label^='Download']").click()
    assert sha256_file(info.value.path()) == big_sum, "in-page download differs from what was sent"
    print("  100 MB saved in-page without a worker and matched")
    return plain


def totp_code(secret, offset=0, when=None):
    """The six digits an authenticator would be showing, RFC 6238."""
    import base64, hashlib, hmac, struct
    raw = secret.replace(" ", "").replace("-", "").upper()
    key = base64.b32decode(raw + "=" * (-len(raw) % 8))
    counter = int((when or time.time()) // 30) + offset
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    return "%06d" % ((struct.unpack(">I", mac[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


def security_flow(srv, out, browser):
    """Authenticator sign-in and the device passcode, end to end."""
    dave = Session(browser, srv.base, "dave", out)
    dave.register("Dave")
    p = dave.page

    # --- turn on an authenticator -------------------------------------------
    dave.open_settings("security")
    p.click("[data-testid=mfa-enable]")
    p.fill("[role=dialog] input[type=password]", PASSWORD)
    p.click("[role=dialog] button:has-text('Continue')")
    p.wait_for_selector("svg[aria-label='Authenticator setup code']", timeout=30000)
    p.click("text=Can't scan it?")
    secret = p.locator("[data-testid=totp-secret]").inner_text()
    dave.shot("security-totp-setup")
    p.fill("[data-testid=totp-code]", totp_code(secret))
    p.click("[data-testid=totp-confirm]")
    p.wait_for_selector("[data-testid=backup-codes]", timeout=30000)
    codes = [c.strip() for c in p.locator("[data-testid=backup-codes]").inner_text().splitlines() if c.strip()]
    assert len(codes) == 10, codes
    dave.shot("security-backup-codes")
    # the codes are shown once, so Done waits until they are said to be saved
    p.check("[data-testid=backup-codes-saved]")
    p.click("[data-testid=backup-codes-done]")
    p.wait_for_selector("[data-testid=mfa-row]:has-text('Authenticator app is on')", timeout=15000)
    dave.close_settings()

    # --- the password alone no longer gets in -------------------------------
    dave.logout()
    p.fill("input[autocomplete=username]", "dave")
    p.fill("input[type=password]", PASSWORD)
    p.click("button[type=submit]")
    p.wait_for_selector("[data-testid=mfa-code]", timeout=45000)
    dave.shot("security-login-code")
    # setting it up spent the current step, so an app would be showing the next one
    p.fill("[data-testid=mfa-code]", totp_code(secret, offset=1))
    p.click("[data-testid=mfa-submit]")
    try:
        p.wait_for_url("**/channels/@me", timeout=20000)
    except Exception:
        # a step boundary went past mid-test; whatever is on screen now is current
        p.fill("[data-testid=mfa-code]", totp_code(secret))
        p.click("[data-testid=mfa-submit]")
        p.wait_for_url("**/channels/@me", timeout=30000)

    # --- a backup code works once -------------------------------------------
    dave.logout()
    p.fill("input[autocomplete=username]", "dave")
    p.fill("input[type=password]", PASSWORD)
    p.click("button[type=submit]")
    p.wait_for_selector("[data-testid=mfa-code]", timeout=45000)
    p.click("button:has-text('Use a backup code')")
    p.fill("[data-testid=mfa-code]", codes[0])
    p.click("[data-testid=mfa-submit]")
    p.wait_for_url("**/channels/@me", timeout=45000)
    dave.open_settings("security")
    p.wait_for_selector("[data-testid=mfa-row]:has-text('9 backup codes left')", timeout=15000)

    # --- a device passcode ---------------------------------------------------
    p.click("[data-testid=lock-set]")
    p.fill("[data-testid=passcode-new]", "137924")
    p.fill("[data-testid=passcode-confirm]", "137924")
    p.click("[data-testid=passcode-save]")
    p.wait_for_selector("[data-testid=lock-row]:has-text('Passcode is on')", timeout=30000)
    dave.shot("security-app-lock")
    dave.close_settings()

    # a reload now stops at the passcode, and a wrong one is refused
    p.reload(wait_until="domcontentloaded")
    p.wait_for_selector("[data-testid=passcode-input]", timeout=45000)
    dave.shot("security-locked")
    p.fill("[data-testid=passcode-input]", "999999")
    p.click("[data-testid=passcode-submit]")
    p.wait_for_selector("text=/Wrong passcode/", timeout=45000)
    p.fill("[data-testid=passcode-input]", "137924")
    p.click("[data-testid=passcode-submit]")
    p.wait_for_url("**/channels/@me", timeout=45000)
    p.wait_for_selector("text=Friends", timeout=20000)

    # locking by hand comes straight back to the passcode screen
    dave.open_settings("security")
    p.click("[data-testid=lock-now]")
    p.wait_for_selector("[data-testid=passcode-input]", timeout=20000)
    p.fill("[data-testid=passcode-input]", "137924")
    p.click("[data-testid=passcode-submit]")
    p.wait_for_selector("text=Friends", timeout=45000)

    # and it can be turned off again
    dave.open_settings("security")
    p.click("[data-testid=lock-remove]")
    p.click("[role=dialog] button:has-text('Remove it')")
    p.wait_for_selector("[data-testid=lock-row]:has-text('No passcode')", timeout=20000)
    dave.close_settings()
    p.reload(wait_until="domcontentloaded")
    p.wait_for_selector("text=Friends", timeout=45000)
    assert p.locator("[data-testid=passcode-input]").count() == 0, "removing the passcode should stop the lock screen"
    return dave


def signed_media_link(srv, target, expires=None, legacy=False):
    """A link to srv's media proxy, signed with srv's own secret the way chatd
    signs (internal/api/proxy_handlers.go): v2 covers a deadline, v1 was the
    address alone. Only a throwaway server's secret is ever read here."""
    import base64, hashlib, hmac
    secret = (Path(srv.dir) / "data" / "server.secret").read_bytes()
    encoded = base64.urlsafe_b64encode(target.encode()).rstrip(b"=").decode()
    if legacy:
        mac = hmac.new(secret, b"media-proxy/v1" + encoded.encode(), hashlib.sha256).digest()[:16]
        sig = base64.urlsafe_b64encode(mac).rstrip(b"=").decode()
    else:
        mac = hmac.new(secret, b"media-proxy/v2" + str(expires).encode() + b"\0" + encoded.encode(), hashlib.sha256).digest()[:16]
        sig = f"{expires}-" + base64.urlsafe_b64encode(mac).rstrip(b"=").decode()
    return f"/media/proxy/{sig}/{encoded}"


def media_flow(srv, alice, bob, path):
    """Link previews in history keep loading, and only through the proxy.

    A preview's links are signed with a deadline and stored inside its
    message's encryption, where the server cannot renew them: a day later they
    were dead, and everything signed before deadlines existed was dead at once.
    Here the sender's previews carry a link whose deadline has passed and one
    signed the old way; the reader's client has to have both signed again and
    show them. The card also names another site's icon, which must never be
    fetched: that request would hand the site the reader's address.
    """
    from urllib.parse import parse_qs, urlparse
    a, b = alice.page, bob.page
    picture = "https://www.gstatic.com/webp/gallery/1.jpg"
    stale = signed_media_link(srv, picture, expires=int(time.time()) - 3600)
    legacy = signed_media_link(srv, picture, legacy=True)
    card = "https://example.com/card"
    previews = {
        picture: {"url": picture, "type": "image", "image": stale, "image_w": 550, "image_h": 368},
        card: {"url": card, "type": "link", "title": "A card with an old picture", "site_name": "example.com",
               "icon": "https://example.com/tracker.png", "image": legacy, "image_w": 550, "image_h": 368},
    }

    def fake_unfurl(route):
        asked = parse_qs(urlparse(route.request.url).query).get("url", [""])[0]
        body = previews.get(asked)
        if body is None:
            route.fulfill(status=204)
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    a.route("**/api/v1/unfurl**", fake_unfurl)
    seen = []
    b.on("request", lambda r: seen.append((r.method, r.url)))
    a.goto(srv.base + path, wait_until="networkidle")
    b.goto(srv.base + path, wait_until="networkidle")
    alice.send("an old picture " + picture)
    alice.send("and an old card " + card)

    def shows(page, text):
        return page.wait_for_function(
            """(t) => {
                const row = [...document.querySelectorAll('[data-id]')].reverse().find(e => e.textContent.includes(t));
                const img = row && row.querySelector('img[data-image-src]');
                return img && img.complete && img.naturalWidth > 0 ? img.getAttribute('src') : null;
            }""",
            arg=text, timeout=45000,
        ).json_value()

    for page, who in ((b, "reader"), (a, "sender")):
        for text in ("an old picture", "an old card"):
            src = shows(page, text)
            assert src.startswith("/media/proxy/"), f"{who}: {text} loaded from {src}"
            deadline = int(src.split("/")[3].split("-")[0])
            assert deadline > time.time() + 3600, f"{who}: {text} was not signed again: {src}"
    refreshes = [u for m, u in seen if m == "POST" and "/api/v1/proxy/refresh" in u]
    assert refreshes, "the reader never asked for links to be signed again"
    elsewhere = [u for _, u in seen if urlparse(u).hostname in ("example.com", "www.gstatic.com")]
    assert not elsewhere, f"the reader fetched from another site: {elsewhere}"
    a.unroute("**/api/v1/unfurl**")
    bob.shot("media")
    print("  media: both old previews signed again and shown; nothing fetched from another site")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tools/out"))
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--serve", action="store_true", help="keep the server running afterwards and print its URL")
    ap.add_argument("--flows", default="all", help="comma-separated subset: server,expressions,voice,polish,groups,security,media,files (register/friends/dm always run)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    chosen = {f.strip() for f in args.flows.split(",") if f.strip()}
    want = lambda name: "all" in chosen or name in chosen  # noqa: E731
    srv = Server(keep=args.keep)
    ok = False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
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
            dm_path = alice.page.url.split(srv.base, 1)[1]
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
            phone.page.wait_for_selector("text=yo from the phone", timeout=20000)
            alice.open_dm_from_sidebar("Carol")
            alice.page.wait_for_selector("text=yo from the phone", timeout=20000)
            phone.shot("dm")
            phone.page.goto(srv.base + "/channels/@me", wait_until="networkidle")
            phone.shot("friends")
            phone.page.click("button[aria-label='Open navigation']")
            time.sleep(0.4)
            phone.shot("drawer")
            server_id = link = None
            if any(want(f) for f in ("server", "expressions", "voice", "polish")):
                print("servers")
                server_id, link = server_flow(srv, alice, bob, phone)
            dave = None
            if want("expressions"):
                print("expressions")
                expressions_flow(srv, alice, bob, server_id, link)
            if want("voice"):
                print("voice")
                voice_flow(srv, alice, bob, server_id)
            if want("polish"):
                print("polish")
                polish_flow(srv, alice, bob, server_id)
            if want("groups"):
                print("groups + packs")
                groups_flow(srv, alice, bob, phone)
            if want("security"):
                print("security: authenticator + app lock")
                dave = security_flow(srv, out, browser)
            if want("media"):
                print("media: old link previews, and nothing from another site")
                media_flow(srv, alice, bob, dm_path)
            plain = None
            if want("files"):
                print("files: pieces, streamed downloads, media on request")
                plain = files_flow(srv, alice, bob, browser, out)
            errors = alice.errors + bob.errors + phone.errors + (dave.errors if dave else []) + (plain.errors if plain else [])
            if errors:
                print("browser errors:\n  " + "\n  ".join(errors))
            ok = not errors
            browser.close()
    except Exception:
        try:
            print("browser errors so far:\n  " + "\n  ".join(alice.errors + bob.errors + phone.errors))
        except Exception:
            pass
        raise
    finally:
        if args.serve and ok:
            print("SERVING", srv.base, "data:", srv.dir)
            print("(ctrl-c to stop)")
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
        srv.stop()
    if args.keep:
        print("kept data dir:", srv.dir)
    print("E2E", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
