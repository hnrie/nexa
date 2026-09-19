#!/usr/bin/env python3
"""The ux-walkthrough driver: uses the product the way a person would and keeps
a screenshot of every screen, with the console and page errors seen on it.

  tools/.venv/bin/python audit/r2/areas/ux-walkthrough/walk.py BASE STEP [STEP ...]

Steps are the functions named step_* below (run `walk.py BASE list`). Shots go
to audit/r2/shots/<platform>/<theme>/<lang>/<screen>.png, errors beside them
in errors.jsonl. Nothing here touches web/dist, bin/chatd or data/.
"""
import json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]  # audit/r2/areas/ux-walkthrough/walk.py → the repo
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools/device"))
from e2e import Session, PASSWORD, png_bytes  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS = ROOT / "audit/r2/shots"
VIEWPORTS = {"web-desktop": (1366, 768), "web-desktop-1920": (1920, 1080), "web-phone": (390, 844), "web-tablet": (820, 1180)}
CHROME_ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
_catalogs = {}


def L(lang, key):
    """A catalogue string by key, so the Arabic and German passes can find controls by their translated names."""
    for lg in ("en", lang):
        if lg not in _catalogs:
            _catalogs[lg] = json.load(open(ROOT / "web/src/i18n/locales" / f"{lg}.json"))
    v = _catalogs[lang].get(key) or _catalogs["en"].get(key) if lang != "en" else _catalogs[lang].get(key)
    if isinstance(v, dict):
        v = v.get("other") or next(iter(v.values()))
    return v


class Walk(Session):
    """One person, one browser context, one platform × theme × language."""

    def __init__(self, browser, base, name, platform, theme="dark", lang="en", standalone=False, color_scheme=None, locale=None):
        self.base, self.name = base, name
        self.platform, self.theme, self.lang = platform, theme, lang
        self.out = SHOTS / platform / theme / lang
        self.out.mkdir(parents=True, exist_ok=True)
        w, h = VIEWPORTS[platform]
        self.ctx = browser.new_context(
            viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=w < 768, has_touch=w < 768,
            permissions=["microphone", "camera"], color_scheme=color_scheme or ("light" if theme == "light" else "dark"),
            locale=locale or {"en": "en-US", "ar": "ar-EG", "de": "de-DE"}[lang],
        )
        if standalone:
            self.ctx.add_init_script("try { localStorage.__standalone = '1' } catch (e) {}")
        self.page = self.ctx.new_page()
        self.screen = "start"
        self.errors = []        # e2e's Session reads this
        self.trace = []
        self.pending = []       # (screen, kind, text) since the last shot
        self.timings = {}
        self.page.on("pageerror", lambda e: self._note("pageerror", str(e)))
        self.page.on("console", lambda m: self._note("console." + m.type, m.text) if m.type in ("error", "warning") else None)
        self.page.on("response", lambda r: self._note("http", f"{r.status} {r.request.method} {r.url}") if r.status >= 400 else None)
        self.log = open(self.out / "errors.jsonl", "a")

    def _note(self, kind, text):
        self.pending.append((self.screen, kind, text[:400]))
        if kind == "pageerror" or (kind == "console.error" and "status of 4" not in text):
            self.errors.append(f"{self.name}: {text}")

    def flush(self):
        for screen, kind, text in self.pending:
            self.log.write(json.dumps({"screen": screen, "kind": kind, "text": text}) + "\n")
        self.log.flush()
        n = len(self.pending)
        self.pending = []
        return n

    def shot(self, name, full=False, clip=None, settle=350):
        """Screenshot the current state as <name>.png and flush the errors seen since the last one."""
        self.screen = name
        self.page.wait_for_timeout(settle)
        path = self.out / f"{name}.png"
        self.page.screenshot(path=str(path), full_page=full, clip=clip)
        n = self.flush()
        print(f"  shot {path.relative_to(ROOT)}" + (f"  ({n} errors logged)" if n else ""))
        return path

    def rel(self, name):
        return str((self.out / f"{name}.png").relative_to(ROOT))

    # ---- inspection helpers ------------------------------------------------
    def aria(self, selector="body"):
        return self.page.locator(selector).first.aria_snapshot()

    def unlabeled(self):
        """Interactive elements with no accessible name."""
        return self.page.evaluate("""() => {
            const out = [];
            const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) || el.textContent || '').trim();
            for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=menuitem], [role=tab], [role=switch], [role=checkbox]')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                let n = name(el);
                if (el.tagName === 'INPUT' && !n) { const lab = el.id && document.querySelector(`label[for="${el.id}"]`); n = (lab?.textContent || el.getAttribute('placeholder') || '').trim(); }
                if (!n) out.push({ tag: el.tagName.toLowerCase(), cls: (el.className && String(el.className).slice(0, 60)) || '', html: el.outerHTML.slice(0, 120), x: Math.round(r.x), y: Math.round(r.y) });
            }
            return out;
        }""")

    def small_targets(self, min_px=44):
        """Visible interactive elements smaller than min_px in either dimension."""
        return self.page.evaluate("""(min) => {
            const out = [];
            for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=option]')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.bottom < 0 || r.top > innerHeight) continue;
                if (r.right < 0 || r.left > innerWidth) continue;
                if (r.width < min || r.height < min) {
                    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40);
                    out.push({ label, w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y) });
                }
            }
            return out;
        }""", min_px)

    def overflow(self):
        """Elements whose content overflows horizontally (clipped or scrolling sideways) and the document's own horizontal scroll."""
        return self.page.evaluate("""() => {
            const out = [];
            const docScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
            for (const el of document.querySelectorAll('body *')) {
                if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
                    const cs = getComputedStyle(el);
                    if (cs.overflowX === 'visible') continue;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue;
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'PRE' || el.tagName === 'CODE') continue;
                    out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth, ox: cs.overflowX });
                }
            }
            return { docScroll, items: out.slice(0, 40) };
        }""")

    def contrast_of(self, selector):
        """Text colour vs the first opaque background behind it, as a WCAG ratio."""
        return self.page.evaluate("""(sel) => {
            const el = document.querySelector(sel); if (!el) return null;
            const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
            const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
            const fg = parse(getComputedStyle(el).color);
            let bg = null, n = el;
            while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) { bg = c; break; } n = n.parentElement; }
            if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0 };
            const l1 = lum(fg), l2 = lum(bg);
            return { fg: getComputedStyle(el).color, bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`, ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 };
        }""", selector)

    def nav_timing(self):
        return self.page.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { ttfb: Math.round(n.responseStart), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round((p.find(e => e.name === 'first-contentful-paint') || {}).startTime || 0) }; }""")

    def tab_order(self, n=25):
        """Press Tab n times and report what gets focus (tag, name, whether a focus ring is visible)."""
        seen = []
        for _ in range(n):
            self.page.keyboard.press("Tab")
            seen.append(self.page.evaluate("""() => { const el = document.activeElement; if (!el || el === document.body) return 'body';
                const cs = getComputedStyle(el); const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none');
                const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30);
                return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${name}" ${ring ? 'ring' : 'NO-RING'}`; }"""))
        return seen

    # ---- product helpers ---------------------------------------------------
    def open_server(self, name_part="Alice"):
        self.page.locator(f'button[aria-label*="{name_part}"]').first.click()
        self.page.wait_for_url("**/channels/*/*", timeout=15000)
        self.page.wait_for_timeout(600)

    def set_appearance(self, theme=None, lang=None):
        """Switch the account's theme/language through the Appearance page (settings travel with the account)."""
        p = self.page
        self.open_settings("appearance")
        if theme:
            p.locator(f"[role=dialog] button:has-text('{theme}')").first.click()
            p.wait_for_timeout(300)
        if lang:
            p.click(f"[data-testid=language-{lang}]")
            p.wait_for_timeout(1500)
        self.close_settings()
        p.wait_for_timeout(500)

    def composer(self):
        """e2e's helper matches the English aria-label; the other languages need their own."""
        loc = self.page.locator("textarea[aria-label^='Message']")
        if loc.count():
            return loc
        return self.page.locator("textarea[aria-label]").last

    def right_click(self, locator):
        locator.click(button="right")
        self.page.wait_for_timeout(300)


# ---- steps ------------------------------------------------------------------

def step_list(base, pw):
    for k in sorted(globals()):
        if k.startswith("step_"):
            print(k[5:])


def step_seed_rest(base, pw):
    """Finish tools/device/seed.py after it stopped at the keyless invite: alice sends one message so the
    server key exists, bob joins through the invite, alice posts the 21 formatting messages."""
    from seed import FORMATTING, post
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login(); bob.login()
    a, b = alice.page, bob.page
    a.wait_for_timeout(1000)
    alice.open_server()
    server_id, general_id = a.url.split("/channels/")[1].split("/")[:2]
    if a.locator("[data-id]").count() == 0:
        alice.send("first message in general")
        a.wait_for_selector("[data-id]:has-text('first message in general')", timeout=20000)
    a.click("button[aria-label='Invite People']")
    box = a.locator("[data-testid=invite-link]")
    box.wait_for(timeout=15000)
    link = ""
    for _ in range(100):
        link = box.input_value()
        if "#k=" in link:
            break
        a.wait_for_timeout(100)
    alice.shot("invite-modal-with-key")
    if "#k=" not in link:
        raise SystemExit(f"invite never got its key: {link}")
    a.keyboard.press("Escape")
    if b.locator('button[aria-label*="Alice"]').count() == 0:
        b.goto(link, wait_until="networkidle")
        bob.shot("invite-page")
        b.click("button:has-text('Accept Invite')")
        b.wait_for_url("**/channels/" + server_id + "/*", timeout=20000)
    print("bob joined", server_id)
    for n, text in enumerate(FORMATTING, 1):
        post(alice, text)
        print(f"  posted {n}/{len(FORMATTING)}")
    voice = a.evaluate("() => [...document.querySelectorAll('[data-channel]')].filter(e => e.textContent.trim() === 'General').map(e => e.getAttribute('data-channel'))[0] ?? null")
    print("SERVER", server_id, "GENERAL", general_id, "VOICE", voice)
    (SHOTS / "seed.json").write_text(json.dumps({"server": server_id, "general": general_id, "voice": voice, "invite": link}))
    browser.close()


def step_d1_auth(base, pw):
    """Web desktop, dark, en: home → register carol → recovery key → first run → settings → logout → login → recover → download → 404."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "carol", "web-desktop")
    p = w.page
    t0 = time.time()
    p.goto(base + "/", wait_until="networkidle")
    print("home timing", w.nav_timing(), "wall %.2fs" % (time.time() - t0))
    w.shot("home")
    w.shot("home-full", full=True)
    print("home unlabeled:", w.unlabeled())
    print("home small targets:", w.small_targets())
    p.click("a[href='/register']")
    p.wait_for_selector("input[autocomplete=username]", timeout=15000)
    w.shot("register-empty")
    print("register tab order:", w.tab_order(10))
    print("register submit enabled when empty:", p.locator("button[type=submit]").is_enabled())
    p.fill("input[autocomplete=username]", "Carol Danvers!")
    p.fill("input[autocomplete=nickname]", "Carol")
    pws = p.locator("input[type=password]")
    pws.nth(0).fill("short")
    pws.nth(1).fill("shorter")
    w.shot("register-invalid")
    p.fill("input[autocomplete=username]", "carol")
    pws.nth(0).fill(PASSWORD)
    pws.nth(1).fill(PASSWORD)
    w.shot("register-filled")
    t0 = time.time()
    p.click("button[type=submit]")
    p.wait_for_selector("[data-testid=recovery-key]", timeout=60000)
    print("register → recovery key: %.2fs" % (time.time() - t0))
    w.recovery = p.locator("[data-testid=recovery-key]").inner_text()
    w.shot("recovery-key")
    print("recovery key aria:\n", w.aria("main, form, [role=dialog]") if p.locator("main, form, [role=dialog]").count() else w.aria())
    print("recovery unlabeled:", w.unlabeled())
    # try to continue without ticking the box
    cont = p.locator("button:has-text('Continue to Nexa')")
    print("continue enabled before tick:", cont.is_enabled())
    if cont.is_enabled():
        cont.click()
        w.shot("recovery-key-continue-unticked")
    p.check("input[type=checkbox]")
    w.shot("recovery-key-ticked")
    t0 = time.time()
    p.click("text=Continue to Nexa")
    p.wait_for_url("**/channels/@me", timeout=30000)
    p.wait_for_selector("text=Friends", timeout=15000)
    print("continue → friends: %.2fs" % (time.time() - t0))
    w.shot("first-run")
    print("first-run unlabeled:", w.unlabeled())
    print("first-run small targets:", w.small_targets())
    print("first-run tab order:", w.tab_order(20))
    (SHOTS / "carol.json").write_text(json.dumps({"recovery": w.recovery}))
    # user settings, then log out
    p.click("button[aria-label='User Settings']")
    p.wait_for_timeout(500)
    w.shot("settings-account")
    p.click("nav button:has-text('Log Out')")
    p.wait_for_timeout(600)
    w.shot("logout-confirm")
    if p.locator("[role=dialog] button:has-text('Log Out')").count():
        p.locator("[role=dialog] button:has-text('Log Out')").last.click()
    p.wait_for_url("**/login**", timeout=30000)
    w.shot("login-after-logout")
    p.fill("input[autocomplete=username]", "carol")
    p.fill("input[type=password]", "wrong password here")
    p.click("button[type=submit]")
    p.wait_for_timeout(2500)
    w.shot("login-wrong-password")
    p.fill("input[type=password]", PASSWORD)
    t0 = time.time()
    p.click("button[type=submit]")
    p.wait_for_url("**/channels/@me", timeout=60000)
    t1 = time.time()
    p.wait_for_selector("text=Friends", timeout=15000)
    print("login submit → url: %.2fs, → Friends visible: %.2fs" % (t1 - t0, time.time() - t0))
    w.shot("after-login")
    # recovery with the key
    w.logout()
    p.goto(base + "/recover", wait_until="networkidle")
    w.shot("recover-empty")
    p.fill("input[autocomplete=username]", "carol")
    p.fill("input[autocomplete=off]", "not-a-key")
    p.locator("input[type=password]").nth(0).fill(PASSWORD)
    p.locator("input[type=password]").nth(1).fill(PASSWORD)
    p.click("button[type=submit]")
    p.wait_for_timeout(2500)
    w.shot("recover-bad-key")
    p.fill("input[autocomplete=off]", w.recovery)
    p.click("button[type=submit]")
    p.wait_for_timeout(6000)
    w.shot("recover-done")
    print("after recover url:", p.url)
    print("recover page text:", p.locator("body").inner_text()[:500].replace("\n", " | "))
    if "checkbox" in p.content():
        try:
            p.check("input[type=checkbox]")
            p.locator("button[type=submit], button:has-text('Continue')").first.click()
            p.wait_for_timeout(3000)
            w.shot("recover-continued")
            print("after recover continue url:", p.url)
        except Exception as e:
            print("recover continue:", str(e)[:100])
    p.goto(base + "/download", wait_until="networkidle")
    w.shot("download")
    w.shot("download-full", full=True)
    p.goto(base + "/nonexistent-page", wait_until="networkidle")
    p.wait_for_timeout(1000)
    w.shot("route-404")
    print("404 url:", p.url)
    browser.close()


def step_dump_general(base, pw):
    """Print every message row in #general as the web client renders it (text + html shape)."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    open_alice_general(w)
    rows = w.page.evaluate("""() => [...document.querySelectorAll('[data-id]')].map(el => ({
        id: el.getAttribute('data-id'),
        text: (el.innerText || '').replace(/\\n/g, ' | ').slice(0, 160),
        imgs: [...el.querySelectorAll('img')].map(i => i.getAttribute('alt') || i.getAttribute('src')?.slice(0, 40)),
        mention: !!el.querySelector('[class*=mention], a[data-user], span[data-mention]'),
    }))""")
    for i, r in enumerate(rows, 1):
        print(f"{i:3d} {r['id'][:6]} mention={r['mention']} imgs={r['imgs']} :: {r['text']}")
    browser.close()


def step_mention(base, pw):
    """The mention/channel autocomplete: does Escape close it or throw the draft away, and how does a
    sent mention render? (seed.py's mention message never arrived — this finds out why.)"""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    open_alice_general(w)
    p = w.page
    box = w.composer()
    box.click()
    p.keyboard.type("hello @bo", delay=30)
    p.wait_for_timeout(800)
    w.shot("composer-mention-autocomplete")
    print("  value before Escape:", repr(box.input_value()))
    print("  listbox:", p.locator("[role=listbox]").count(), p.locator("[role=listbox]").first.inner_text()[:200].replace("\n", " | ") if p.locator("[role=listbox]").count() else "")
    p.keyboard.press("Escape")
    p.wait_for_timeout(400)
    print("  value after 1st Escape:", repr(box.input_value()))
    w.shot("composer-after-escape")
    p.keyboard.press("Escape")
    p.wait_for_timeout(300)
    print("  value after 2nd Escape:", repr(box.input_value()))
    # and the same for the channel autocomplete
    box.click()
    box.fill("")
    p.keyboard.type("see #gen", delay=30)
    p.wait_for_timeout(800)
    w.shot("composer-channel-autocomplete")
    print("  channel value before Escape:", repr(box.input_value()))
    p.keyboard.press("Escape")
    p.wait_for_timeout(400)
    print("  channel value after Escape:", repr(box.input_value()))
    # now actually send a mention, picking it from the list
    box.click()
    box.fill("")
    p.keyboard.type("a mention of @bo", delay=30)
    p.wait_for_timeout(800)
    p.keyboard.press("Enter")       # takes the highlighted suggestion
    p.wait_for_timeout(400)
    print("  value after picking:", repr(box.input_value()))
    p.keyboard.type("and a channel #gen", delay=30)
    p.wait_for_timeout(700)
    p.keyboard.press("Enter")
    p.wait_for_timeout(400)
    print("  value after picking channel:", repr(box.input_value()))
    p.keyboard.press("Enter")
    p.wait_for_timeout(2000)
    w.shot("general-mention-sent")
    print("  last row:", p.locator("[data-id]").last.inner_text().replace("\n", " | ")[:200])
    browser.close()


def step_mention_seed(base, pw):
    """Replay seed.py's exact sequence for the message that never arrived: type, Escape, Enter."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    open_alice_general(w)
    p, box = w.page, w.composer()
    before = p.locator("[data-id]").count()
    box.click()
    p.keyboard.type("a mention of @bob and a channel #general", delay=4)
    p.wait_for_timeout(600)
    w.shot("composer-seed-mention-typed")
    print("  listbox open:", p.locator("[role=listbox]").count(), "value:", repr(box.input_value()))
    p.keyboard.press("Escape")
    p.wait_for_timeout(300)
    print("  after Escape value:", repr(box.input_value()), "listbox:", p.locator("[role=listbox]").count())
    p.keyboard.press("Enter")
    p.wait_for_timeout(2500)
    print("  after Enter value:", repr(box.input_value()))
    after = p.locator("[data-id]").count()
    print("  rows before/after:", before, after)
    w.shot("general-seed-mention-after-enter")
    print("  last row:", p.locator("[data-id]").last.inner_text().replace("\n", " | ")[:220])
    # what a message with a real channel link looks like, typed the way a person would
    box.click(); box.fill("")
    p.keyboard.type("go to #gen", delay=30)
    p.wait_for_timeout(800)
    n = p.locator("[role=listbox]").count()
    print("  channel listbox:", n, p.locator("[role=listbox]").first.inner_text()[:120].replace("\n", " | ") if n else "")
    p.keyboard.press("Tab")
    p.wait_for_timeout(500)
    print("  after Tab value:", repr(box.input_value()))
    w.shot("composer-channel-tab")
    p.keyboard.press("Enter")
    p.wait_for_timeout(2000)
    print("  last row now:", p.locator("[data-id]").last.inner_text().replace("\n", " | ")[:220])
    w.shot("general-channel-link-sent")
    browser.close()


FAILS = []


def attempt(w, label, fn):
    """Run one screen's worth of driving; a failure is recorded, shot and stepped over."""
    try:
        fn()
        return True
    except Exception as e:
        msg = f"{type(e).__name__}: {str(e).splitlines()[0][:160] if str(e) else ''}"
        print(f"  !! {label}: {msg}")
        FAILS.append(f"{w.platform}/{w.theme}/{w.lang} {label}: {msg}")
        try:
            w.shot("fail-" + label)
        except Exception:
            pass
        for _ in range(3):
            try:
                w.page.keyboard.press("Escape")
                w.page.wait_for_timeout(150)
            except Exception:
                pass
        return False


def diag(w, label, small=True):
    u = w.unlabeled()
    s = w.small_targets() if small else []
    o = w.overflow()
    if u:
        print(f"  [{label}] unlabeled: {json.dumps(u)[:900]}")
    if s:
        print(f"  [{label}] small: {json.dumps(s)[:900]}")
    if o["docScroll"] or o["items"]:
        print(f"  [{label}] overflow: docScroll={o['docScroll']} {json.dumps(o['items'])[:700]}")


def seed_ids():
    return json.loads((SHOTS / "seed.json").read_text())


def open_alice_general(w):
    ids = seed_ids()
    w.page.goto(w.base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
    w.page.wait_for_selector("[data-id]", timeout=20000)
    w.page.wait_for_timeout(800)


def step_d2_friends(base, pw):
    """Friends page: every tab, the add-friend errors, a request, accepting it, the new DM."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login()
    bob.login()
    a, b = alice.page, bob.page
    a.wait_for_timeout(1200)
    attempt(alice, "friends-online", lambda: (a.goto(base + "/channels/@me", wait_until="networkidle"), a.wait_for_timeout(800), alice.shot("friends-online"), diag(alice, "friends-online")))
    for tab in ("All", "Pending", "Blocked"):
        attempt(alice, "friends-" + tab.lower(), lambda tab=tab: (a.click(f"button:has-text('{tab}')"), a.wait_for_timeout(600), alice.shot("friends-" + tab.lower())))
    def add_friend_screens():
        a.click("text=Add Friend")
        a.wait_for_timeout(500)
        alice.shot("friends-add")
        diag(alice, "friends-add")
        print("  add-friend submit enabled when empty:", a.locator("button:has-text('Send Friend Request')").is_enabled())
        a.fill("input[aria-label=Username]", "nosuchperson")
        a.click("text=Send Friend Request")
        a.wait_for_timeout(2000)
        alice.shot("friends-add-unknown")
        print("  unknown-user text:", " | ".join(t.strip() for t in a.locator("[role=status], [class*=error], [class*=Error]").all_inner_texts())[:300])
        a.fill("input[aria-label=Username]", "alice")
        a.click("text=Send Friend Request")
        a.wait_for_timeout(2000)
        alice.shot("friends-add-self")
        print("  self text:", " | ".join(t.strip() for t in a.locator("[role=status], [class*=error], [class*=Error]").all_inner_texts())[:300])
        a.fill("input[aria-label=Username]", "bob")
        a.click("text=Send Friend Request")
        a.wait_for_timeout(2500)
        alice.shot("friends-add-sent")
        print("  sent text:", " | ".join(t.strip() for t in a.locator("[role=status], [class*=Success], [class*=success]").all_inner_texts())[:300])
    attempt(alice, "friends-add", add_friend_screens)
    attempt(alice, "friends-pending-outgoing", lambda: (a.click("button:has-text('Pending')"), a.wait_for_timeout(800), alice.shot("friends-pending-outgoing")))
    def bob_accepts():
        b.goto(base + "/channels/@me", wait_until="networkidle")
        b.wait_for_timeout(1000)
        bob.shot("friends-pending-badge")
        b.click("button:has-text('Pending')")
        b.wait_for_timeout(800)
        bob.shot("friends-pending-incoming")
        diag(bob, "friends-pending-incoming")
        b.click("button[aria-label=Accept]")
        b.wait_for_timeout(2500)
        bob.shot("friends-after-accept")
        print("  bob url after accept:", b.url)
    attempt(bob, "friends-accept", bob_accepts)
    def alice_dm():
        a.goto(base + "/channels/@me", wait_until="networkidle")
        a.click("button:has-text('All')")
        a.wait_for_timeout(900)
        alice.shot("friends-all-with-bob")
        diag(alice, "friends-all-with-bob")
        row = a.locator("[data-user] button[aria-label=Message]").first
        row.click()
        a.wait_for_url("**/channels/@me/*", timeout=15000)
        a.wait_for_timeout(1200)
        alice.shot("dm-empty")
        diag(alice, "dm-empty")
    attempt(alice, "dm-open", alice_dm)
    print("FAILS:", FAILS)
    browser.close()


def step_d3_messages(base, pw):
    """A DM conversation: sending, hover actions, reaction, reply, edit, pin, delete, long and URL-only
    messages, then the seeded formatting messages in #general."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login(); bob.login()
    a, b = alice.page, bob.page
    a.wait_for_timeout(1000)
    attempt(alice, "dm-open", lambda: alice.open_dm_from_sidebar("Bob", "bob"))
    def send_basics():
        alice.send("hey bob, first DM message")
        a.wait_for_selector("[data-id]:has-text('first DM message')", timeout=20000)
        alice.shot("dm-sent")
        b.wait_for_timeout(1500)
    attempt(alice, "dm-send", send_basics)
    def typing_indicator():
        bob.open_dm_from_sidebar("Alice", "alice")
        b.wait_for_timeout(800)
        bob.composer().click()
        b.keyboard.type("bob is typing a reply", delay=30)
        a.wait_for_timeout(1500)
        alice.shot("dm-typing-indicator")
        print("  typing text:", a.locator("main").inner_text()[-260:].replace("\n", " | "))
        b.keyboard.press("Enter")
        a.wait_for_timeout(1200)
        alice.shot("dm-two-people")
    attempt(bob, "dm-typing", typing_indicator)
    def hover_actions():
        row = alice.message_row("first DM message")
        row.hover()
        a.wait_for_timeout(400)
        alice.shot("dm-hover-actions")
        print("  hover toolbar aria:", row.aria_snapshot()[:700])
    attempt(alice, "dm-hover", hover_actions)
    def context_menu():
        alice.right_click(alice.message_row("first DM message"))
        alice.shot("dm-context-menu")
        print("  menu aria:", a.locator("[role=menu]").first.aria_snapshot()[:900] if a.locator("[role=menu]").count() else "NO [role=menu]")
        a.keyboard.press("Escape")
    attempt(alice, "dm-context-menu", context_menu)
    def reaction():
        row = alice.message_row("first DM message")
        row.hover()
        a.wait_for_timeout(300)
        row.locator("button[aria-label*='eact'], button[aria-label*='moji']").first.click()
        a.wait_for_timeout(700)
        alice.shot("emoji-picker-react")
        diag(alice, "emoji-picker")
        a.locator("[role=dialog] button[data-emoji], [role=dialog] button").nth(8).click()
        a.wait_for_timeout(1200)
        alice.shot("dm-reacted")
    attempt(alice, "dm-react", reaction)
    def reply():
        row = alice.message_row("bob is typing a reply") if a.locator("[data-id]:has-text('bob is typing a reply')").count() else alice.message_row("first DM message")
        row.hover()
        a.wait_for_timeout(300)
        row.locator("button[aria-label*='eply']").first.click()
        a.wait_for_timeout(600)
        alice.shot("dm-reply-composing")
        alice.composer().type("replying to that")
        a.keyboard.press("Enter")
        a.wait_for_timeout(1500)
        alice.shot("dm-replied")
    attempt(alice, "dm-reply", reply)
    def edit():
        row = alice.message_row("replying to that")
        row.hover()
        a.wait_for_timeout(300)
        if row.locator("button[aria-label*='dit']").count():
            row.locator("button[aria-label*='dit']").first.click()
        else:
            alice.right_click(row); a.click("[role=menu] >> text=Edit")
        a.wait_for_timeout(600)
        alice.shot("dm-editing")
        a.keyboard.type(" (edited text)")
        a.keyboard.press("Enter")
        a.wait_for_timeout(1500)
        alice.shot("dm-edited")
    attempt(alice, "dm-edit", edit)
    def pin():
        row = alice.message_row("first DM message")
        alice.right_click(row)
        a.click("[role=menu] >> text=Pin")
        a.wait_for_timeout(900)
        alice.shot("dm-pin-confirm")
        if a.locator("[role=dialog] button:has-text('Pin')").count():
            a.locator("[role=dialog] button:has-text('Pin')").last.click()
            a.wait_for_timeout(1200)
        alice.shot("dm-pinned")
        a.click("button[aria-label*='inned']")
        a.wait_for_timeout(900)
        alice.shot("dm-pins-panel")
        diag(alice, "pins-panel")
        a.keyboard.press("Escape")
    attempt(alice, "dm-pin", pin)
    def long_and_url():
        alice.composer().fill("x" * 40 + " " + ("a very long sentence that keeps going " * 45))
        a.wait_for_timeout(400)
        alice.shot("dm-composer-long")
        a.keyboard.press("Enter")
        a.wait_for_timeout(1800)
        alice.shot("dm-long-message")
        alice.send("https://example.com")
        a.wait_for_timeout(2500)
        alice.shot("dm-url-only")
        alice.send("https://github.com/evilion/nexa/blob/main/README.md?x=1#section")
        a.wait_for_timeout(2500)
        alice.shot("dm-url-long")
    attempt(alice, "dm-long", long_and_url)
    def deleting():
        row = alice.message_row("https://example.com")
        alice.right_click(row)
        a.click("[role=menu] >> text=Delete")
        a.wait_for_timeout(800)
        alice.shot("dm-delete-confirm")
        a.locator("[role=dialog] button:has-text('Delete')").last.click()
        a.wait_for_timeout(1500)
        alice.shot("dm-after-delete")
    attempt(alice, "dm-delete", deleting)
    def formatting():
        open_alice_general(alice)
        alice.shot("general-formatting-bottom")
        n = a.locator("[data-id]").count()
        print("  messages in general:", n)
        a.mouse.wheel(0, -1400); a.wait_for_timeout(700); alice.shot("general-formatting-mid")
        a.mouse.wheel(0, -1400); a.wait_for_timeout(700); alice.shot("general-formatting-up")
        a.mouse.wheel(0, -1400); a.wait_for_timeout(700); alice.shot("general-formatting-top")
        alice.shot("general-formatting-full", full=True)
        diag(alice, "general")
        sp = a.locator("[data-id] :text('a spoiler')").first
        if sp.count():
            sp.click(); a.wait_for_timeout(500); alice.shot("general-spoiler-open")
    attempt(alice, "general-formatting", formatting)
    print("FAILS:", FAILS)
    browser.close()


def step_d4_attach(base, pw):
    """Attachments: image, file, many; the lightbox; the drop overlay."""
    import io, struct as _struct, zlib as _zlib
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    alice.login()
    a = alice.page
    a.wait_for_timeout(1000)
    attempt(alice, "dm-open", lambda: alice.open_dm_from_sidebar("Bob", "bob"))
    files = [
        {"name": "screenshot.png", "mimeType": "image/png", "buffer": png_bytes(900, 600, (80, 120, 220))},
        {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"a text file with a few words in it\n" * 40},
    ]
    def upload_one():
        a.set_input_files("input[type=file]", files[0])
        a.wait_for_timeout(1200)
        alice.shot("composer-attachment-preview")
        diag(alice, "attachment-preview")
        a.keyboard.press("Enter")
        a.wait_for_timeout(3500)
        alice.shot("dm-image-sent")
    attempt(alice, "attach-image", upload_one)
    def lightbox():
        a.locator("[data-id] img").last.click()
        a.wait_for_timeout(900)
        alice.shot("image-lightbox")
        diag(alice, "lightbox")
        print("  lightbox aria:", a.locator("[role=dialog]").first.aria_snapshot()[:700] if a.locator("[role=dialog]").count() else "no dialog")
        a.keyboard.press("Escape")
    attempt(alice, "lightbox", lightbox)
    def upload_file():
        a.set_input_files("input[type=file]", files[1])
        a.wait_for_timeout(1000)
        a.keyboard.press("Enter")
        a.wait_for_timeout(3000)
        alice.shot("dm-file-sent")
    attempt(alice, "attach-file", upload_file)
    def upload_many():
        many = [{"name": f"pic{i:02d}.png", "mimeType": "image/png", "buffer": png_bytes(240, 160, (30 + i * 9, 90, 200 - i * 6))} for i in range(20)]
        a.set_input_files("input[type=file]", many)
        a.wait_for_timeout(2500)
        alice.shot("composer-twenty-attachments")
        diag(alice, "twenty-attachments")
        print("  attachment error text:", a.locator("main").inner_text()[-400:].replace("\n", " | "))
    attempt(alice, "attach-twenty", upload_many)
    def drop_overlay():
        a.reload(wait_until="networkidle")
        a.wait_for_timeout(1500)
        a.evaluate("""() => {
            const dt = new DataTransfer();
            dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
            const ev = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
            document.querySelector('main, body').dispatchEvent(ev);
            const ev2 = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
            document.querySelector('main, body').dispatchEvent(ev2);
        }""")
        a.wait_for_timeout(600)
        alice.shot("drop-overlay")
        print("  drop overlay present:", a.locator("[data-testid=drop-overlay]").count())
    attempt(alice, "drop-overlay", drop_overlay)
    print("FAILS:", FAILS)
    browser.close()


def step_d5_server(base, pw):
    """The server: header menu, invite, create channel/category, channel settings, every server-settings page,
    the member list and its menus."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    p = w.page
    attempt(w, "server-open", lambda: open_alice_general(w))
    attempt(w, "server-menu", lambda: (p.click("button:has-text(\"Alice's server\")"), p.wait_for_timeout(500), w.shot("server-header-menu"), print("  menu:", p.locator("[role=menu]").first.aria_snapshot()[:800] if p.locator("[role=menu]").count() else "none")))
    p.keyboard.press("Escape")
    attempt(w, "invite-modal", lambda: (p.click("button[aria-label='Invite People']"), p.wait_for_timeout(1200), w.shot("invite-modal"), diag(w, "invite-modal"), p.keyboard.press("Escape")))
    def create_channel():
        p.click("button[aria-label='Create Channel']")
        p.wait_for_timeout(600)
        w.shot("create-channel-modal")
        diag(w, "create-channel-modal")
        print("  create-channel aria:", p.locator("[role=dialog]").first.aria_snapshot()[:900])
        p.fill("[data-testid=channel-name]", "Plans For The Weekend")
        p.wait_for_timeout(300)
        w.shot("create-channel-filled")
        print("  name as typed:", p.locator("[data-testid=channel-name]").input_value())
        p.click("button:has-text('Create Channel')")
        p.wait_for_timeout(2500)
        w.shot("channel-empty")
        print("  url:", p.url)
    attempt(w, "create-channel", create_channel)
    def create_voice_and_private():
        p.click("button[aria-label='Create Channel']")
        p.wait_for_timeout(500)
        p.locator("[role=dialog] button:has-text('Voice')").first.click()
        p.fill("[data-testid=channel-name]", "Late Night")
        p.locator("[role=dialog] input[role=switch]").first.check()
        p.wait_for_timeout(300)
        w.shot("create-channel-voice-private")
        p.click("button:has-text('Create Channel')")
        p.wait_for_timeout(2000)
        w.shot("sidebar-after-channels")
    attempt(w, "create-voice-private", create_voice_and_private)
    def channel_settings():
        row = p.locator("[data-channel]:has-text('Plans For The Weekend')").first
        row.hover()
        p.wait_for_timeout(300)
        w.shot("channel-row-hover")
        row.locator("button").last.click()
        p.wait_for_timeout(900)
        w.shot("channel-settings-overview")
        diag(w, "channel-settings")
        print("  channel settings aria:", p.locator("[role=dialog]").first.aria_snapshot()[:1200])
        for nav in ("permissions", "delete"):
            if p.locator(f"[data-nav={nav}]").count():
                p.click(f"[data-nav={nav}]")
                p.wait_for_timeout(700)
                w.shot("channel-settings-" + nav)
        p.keyboard.press("Escape")
    attempt(w, "channel-settings", channel_settings)
    def server_settings():
        p.click("button:has-text(\"Alice's server\")")
        p.wait_for_timeout(400)
        p.click("text=Server Settings")
        p.wait_for_timeout(1200)
        w.shot("server-settings-overview")
        diag(w, "server-settings")
        print("  server settings nav:", p.locator("[role=dialog] nav").first.inner_text().replace("\n", " | ")[:300])
        for nav in ("roles", "emoji", "stickers", "encryption", "members", "invites", "bans", "audit", "delete"):
            if p.locator(f"[data-nav={nav}]").count() == 0:
                print("  no nav:", nav)
                continue
            p.click(f"[data-nav={nav}]")
            p.wait_for_timeout(900)
            w.shot("server-settings-" + nav)
            diag(w, "server-settings-" + nav, small=False)
        p.keyboard.press("Escape")
    attempt(w, "server-settings", server_settings)
    def roles_editor():
        p.click("button:has-text(\"Alice's server\")")
        p.wait_for_timeout(400)
        p.click("text=Server Settings")
        p.wait_for_timeout(900)
        p.click("[data-nav=roles]")
        p.wait_for_timeout(600)
        p.click("[data-testid=create-role]")
        p.wait_for_timeout(900)
        w.shot("role-editor")
        diag(w, "role-editor")
        p.fill("[data-testid=role-name]", "Moderators")
        p.wait_for_timeout(300)
        w.shot("role-editor-filled")
        p.click("[data-testid=save]")
        p.wait_for_timeout(1200)
        w.shot("role-saved")
        p.keyboard.press("Escape")
    attempt(w, "roles", roles_editor)
    def members_and_profile():
        open_alice_general(w)
        p.locator("[data-testid=member-list] [data-user]").first.click()
        p.wait_for_timeout(900)
        w.shot("profile-card")
        diag(w, "profile-card")
        p.keyboard.press("Escape")
        w.right_click(p.locator("[data-testid=member-list] [data-user]").last)
        w.shot("member-context-menu")
        print("  member menu:", p.locator("[role=menu]").first.aria_snapshot()[:800] if p.locator("[role=menu]").count() else "none")
        p.keyboard.press("Escape")
    attempt(w, "members", members_and_profile)
    def notif_and_profile_modals():
        p.click("button:has-text(\"Alice's server\")")
        p.wait_for_timeout(400)
        menu = p.locator("[role=menu]").first.inner_text().replace("\n", " | ")
        print("  server menu items:", menu[:300])
        for label in ("Notification Settings", "Edit Server Profile", "Privacy Settings"):
            if label in menu:
                p.click(f"[role=menu] >> text={label}")
                p.wait_for_timeout(900)
                w.shot("server-menu-" + label.lower().replace(" ", "-"))
                diag(w, label, small=False)
                p.keyboard.press("Escape")
                p.wait_for_timeout(400)
                p.click("button:has-text(\"Alice's server\")")
                p.wait_for_timeout(400)
        p.keyboard.press("Escape")
    attempt(w, "server-menu-modals", notif_and_profile_modals)
    print("FAILS:", FAILS)
    browser.close()


SETTINGS_NAVS = ["account", "profiles", "privacy", "security", "devices", "appearance", "voice", "notifications", "stickers", "licenses", "admin", "get-app"]


def step_d6_settings(base, pw):
    """Every user-settings page, the profile and status modals, search, the quick switcher, shortcuts."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    p = w.page
    p.wait_for_timeout(1200)
    def settings_pages():
        p.click("button[aria-label='User Settings']")
        p.wait_for_timeout(1000)
        w.shot("settings-open")
        print("  settings nav:", p.locator("[role=dialog] nav").first.inner_text().replace("\n", " | ")[:400])
        for nav in SETTINGS_NAVS:
            if p.locator(f"[data-nav={nav}]").count() == 0:
                print("  no nav:", nav)
                continue
            p.click(f"[data-nav={nav}]")
            p.wait_for_timeout(900)
            w.shot("settings-" + nav)
            w.shot("settings-" + nav + "-full", full=True)
            diag(w, "settings-" + nav, small=False)
        p.keyboard.press("Escape")
    attempt(w, "settings-pages", settings_pages)
    def own_profile():
        p.click("button[aria-label='User Settings']")
        p.wait_for_timeout(700)
        p.click("[data-nav=profiles]")
        p.wait_for_timeout(900)
        w.shot("settings-profiles-detail")
        p.keyboard.press("Escape")
        p.wait_for_timeout(500)
        p.locator("button[aria-label*='Alice'], button:has-text('Alice')").first.click()
        p.wait_for_timeout(800)
        w.shot("own-user-panel-menu")
        print("  panel menu:", p.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if p.locator("[role=menu]").count() else "none")
        if p.locator("[role=menu] >> text=/Custom Status|Set Status/i").count():
            p.locator("[role=menu] >> text=/Custom Status|Set Status/i").first.click()
            p.wait_for_timeout(900)
            w.shot("custom-status-modal")
            diag(w, "custom-status")
        p.keyboard.press("Escape")
    attempt(w, "own-profile", own_profile)
    def search():
        open_alice_general(w)
        p.click("input[placeholder='Search'], [aria-label=Search]")
        p.wait_for_timeout(700)
        w.shot("search-suggestions")
        diag(w, "search")
        p.keyboard.type("formatting", delay=30)
        p.keyboard.press("Enter")
        p.wait_for_timeout(2500)
        w.shot("search-results")
        diag(w, "search-results", small=False)
        print("  results text:", p.locator("main, [class*=search]").first.inner_text()[:400].replace("\n", " | "))
        p.keyboard.press("Escape")
    attempt(w, "search", search)
    def switcher():
        p.keyboard.press("Control+k")
        p.wait_for_timeout(700)
        w.shot("quick-switcher")
        diag(w, "quick-switcher")
        p.keyboard.type("gen", delay=40)
        p.wait_for_timeout(800)
        w.shot("quick-switcher-typed")
        print("  hits:", p.locator("[data-testid=switcher-hit]").count(), p.locator("[data-testid=switcher-hit]").first.inner_text()[:80] if p.locator("[data-testid=switcher-hit]").count() else "")
        p.keyboard.press("Escape")
    attempt(w, "switcher", switcher)
    def shortcuts():
        p.keyboard.press("Control+/")
        p.wait_for_timeout(800)
        w.shot("shortcuts-help")
        if p.locator("[role=dialog]").count() == 0:
            p.keyboard.press("Shift+?")
            p.wait_for_timeout(800)
            w.shot("shortcuts-help-2")
        print("  shortcuts dialog:", p.locator("[role=dialog]").count())
        p.keyboard.press("Escape")
    attempt(w, "shortcuts", shortcuts)
    def slash_commands():
        open_alice_general(w)
        w.composer().click()
        p.keyboard.type("/", delay=50)
        p.wait_for_timeout(800)
        w.shot("composer-slash-commands")
        print("  slash listbox:", p.locator("[role=listbox]").count(), p.locator("[role=listbox]").first.inner_text()[:300].replace("\n", " | ") if p.locator("[role=listbox]").count() else "")
        p.keyboard.press("Escape")
        w.composer().fill("")
    attempt(w, "slash", slash_commands)
    def pickers():
        open_alice_general(w)
        p.click("button[aria-label='Select emoji']")
        p.wait_for_timeout(1000)
        w.shot("expression-picker-emoji")
        diag(w, "picker-emoji")
        for tab in ("GIFs", "Stickers"):
            if p.locator(f"[role=dialog] button:has-text('{tab}')").count():
                p.click(f"[role=dialog] button:has-text('{tab}')")
                p.wait_for_timeout(900)
                w.shot("expression-picker-" + tab.lower())
        p.keyboard.press("Escape")
    attempt(w, "pickers", pickers)
    def tab_pass():
        open_alice_general(w)
        p.keyboard.press("Escape")
        order = w.tab_order(22)
        print("  channel tab order:")
        for o in order:
            print("   ", o)
        w.shot("focus-ring-channel")
    attempt(w, "tab-order", tab_pass)
    print("FAILS:", FAILS)
    browser.close()


def step_d7_voice(base, pw):
    """Voice: two people in the server's General, the call UI, mute/deafen, screen share, a DM call and the
    incoming-call screen."""
    browser = pw.chromium.launch(args=CHROME_ARGS + ["--auto-select-desktop-capture-source=Entire screen"])
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login(); bob.login()
    a, b = alice.page, bob.page
    a.wait_for_timeout(1000)
    ids = seed_ids()
    def join():
        open_alice_general(alice)
        a.locator("[data-channel]:has-text('General')").first.click()
        a.wait_for_timeout(2500)
        alice.shot("voice-joined-alone")
        diag(alice, "voice")
        print("  voice status:", a.locator("[data-testid=voice-status]").inner_text().replace("\n", " | ")[:200] if a.locator("[data-testid=voice-status]").count() else "none")
    attempt(alice, "voice-join", join)
    def bob_join():
        b.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        b.wait_for_timeout(1500)
        b.locator("[data-channel]:has-text('General')").first.click()
        b.wait_for_timeout(4000)
        bob.shot("voice-two-people-bob")
        alice.shot("voice-two-people")
        diag(alice, "voice-two")
    attempt(bob, "voice-join-bob", bob_join)
    def controls():
        for label in ("Mute", "Deafen"):
            if a.locator(f"button[aria-label='{label}']").count():
                a.click(f"button[aria-label='{label}']")
                a.wait_for_timeout(800)
                alice.shot("voice-" + label.lower())
        if a.locator("button[aria-label='Unmute']").count():
            a.click("button[aria-label='Unmute']")
        if a.locator("button[aria-label='Undeafen']").count():
            a.click("button[aria-label='Undeafen']")
        a.wait_for_timeout(500)
        if a.locator("[data-testid=voice-participants]").count():
            alice.shot("voice-participants")
    attempt(alice, "voice-controls", controls)
    def screen_share():
        btn = a.locator("[data-testid=go-live], button[aria-label*='Screen'], button[aria-label*='Share']").first
        btn.click()
        a.wait_for_timeout(1200)
        alice.shot("screen-share-modal")
        diag(alice, "screen-share")
        print("  share modal:", a.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:400] if a.locator("[role=dialog]").count() else "none")
        if a.locator("[data-testid=display-share]").count():
            a.click("[data-testid=display-share]")
            a.wait_for_timeout(3000)
            alice.shot("screen-sharing")
            b.wait_for_timeout(2000)
            bob.shot("screen-share-seen-by-bob")
    attempt(alice, "screen-share", screen_share)
    def leave():
        if a.locator("[data-testid=voice-status-leave]").count():
            a.click("[data-testid=voice-status-leave]")
        a.wait_for_timeout(1500)
        alice.shot("voice-after-leave")
        if b.locator("[data-testid=voice-status-leave]").count():
            b.click("[data-testid=voice-status-leave]")
        b.wait_for_timeout(1000)
    attempt(alice, "voice-leave", leave)
    def dm_call():
        alice.open_dm_from_sidebar("Bob", "bob")
        a.wait_for_timeout(1200)
        a.locator("[data-testid=start-call], button[aria-label='Start Voice Call']").first.click()
        a.wait_for_timeout(2500)
        alice.shot("dm-call-ringing")
        bob.open_dm_from_sidebar("Alice", "alice")
        b.wait_for_timeout(2500)
        bob.shot("incoming-call")
        print("  incoming call present:", b.locator("[data-testid=incoming-call]").count())
        if b.locator("[data-testid=accept-call]").count():
            b.click("[data-testid=accept-call]")
            b.wait_for_timeout(3500)
            bob.shot("dm-call-connected-bob")
            alice.shot("dm-call-connected")
            diag(alice, "dm-call")
        if a.locator("[data-testid=voice-status-leave]").count():
            a.click("[data-testid=voice-status-leave]")
        a.wait_for_timeout(1200)
        alice.shot("dm-after-call")
    attempt(alice, "dm-call", dm_call)
    print("FAILS:", FAILS)
    browser.close()


def step_probe(base, pw):
    """Targeted live checks behind findings: how a channel's settings are reached, whether the member-list
    moderation icons have names, where the Devices sweep button sits, the lightbox chrome, contrasts."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    w.login()
    p = w.page
    def channel_entry():
        open_alice_general(w)
        row = p.locator("[data-channel]").first
        print("  channel row html:", row.evaluate("el => el.outerHTML.slice(0, 400)"))
        row.hover(); p.wait_for_timeout(500)
        print("  buttons in row on hover:", row.locator("button").count(),
              [row.locator("button").nth(i).get_attribute("aria-label") for i in range(row.locator("button").count())])
        w.shot("probe-channel-row-hover")
        w.right_click(row)
        print("  channel right-click menu:", p.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if p.locator("[role=menu]").count() else "NO MENU")
        w.shot("probe-channel-context-menu")
        p.keyboard.press("Escape")
    attempt(w, "probe-channel-entry", channel_entry)
    def member_icons():
        p.click("button:has-text(\"Alice's server\")"); p.wait_for_timeout(400)
        p.click("text=Server Settings"); p.wait_for_timeout(1200)
        p.click("[data-nav=members]"); p.wait_for_timeout(900)
        rows = p.locator("[role=dialog] button")
        print("  member page buttons:", p.evaluate("""() => [...document.querySelectorAll('[role=dialog] button')].map(b => ({
            label: (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 40),
            w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))"""))
        _ = rows
        print("  unlabeled here:", json.dumps(w.unlabeled())[:600])
        w.shot("probe-server-members")
        p.keyboard.press("Escape")
    attempt(w, "probe-member-icons", member_icons)
    def devices():
        w.open_settings("devices"); p.wait_for_timeout(1200)
        info = p.evaluate("""() => {
            const d = document.querySelector('[role=dialog]');
            const sc = [...d.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 300);
            const btn = [...d.querySelectorAll('button')].find(b => /all other/i.test(b.textContent || ''));
            return { scrollHeight: sc ? sc.scrollHeight : null, clientHeight: sc ? sc.clientHeight : null,
                     sweepTop: btn ? Math.round(btn.getBoundingClientRect().top) : null, innerHeight };
        }""")
        print("  devices:", info)
        w.shot("probe-devices-top")
        p.evaluate("""() => { const d = document.querySelector('[role=dialog]'); const sc = [...d.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 300); if (sc) sc.scrollTop = sc.scrollHeight; }""")
        p.wait_for_timeout(500)
        w.shot("probe-devices-bottom")
        w.close_settings()
    attempt(w, "probe-devices", devices)
    def lightbox():
        alice_dm = lambda: w.open_dm_from_sidebar("Bob", "bob")
        alice_dm()
        p.wait_for_timeout(1500)
        img = p.locator("[data-id] img").last
        img.click()
        p.wait_for_timeout(1200)
        print("  lightbox chrome:", p.evaluate("""() => {
            const out = [];
            for (const el of document.querySelectorAll('button, a[href]')) {
                const r = el.getBoundingClientRect();
                if (r.height === 0 || r.top < innerHeight - 90) continue;
                out.push({ t: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
            }
            const comp = document.querySelector("textarea[aria-label^='Message']");
            return { bottom: out, composerTop: comp ? Math.round(comp.getBoundingClientRect().top) : null, innerHeight };
        }"""))
        print("  lightbox filename shown:", "screenshot.png" in p.locator("body").inner_text())
        w.shot("probe-lightbox")
        p.keyboard.press("Escape")
    attempt(w, "probe-lightbox", lightbox)
    def contrasts():
        open_alice_general(w)
        for sel in ("[data-channel] a, [data-channel]", "time", "[class*=hint]", "textarea[aria-label^='Message']"):
            print(f"  contrast {sel}:", w.contrast_of(sel))
        print("  placeholder contrast:", p.evaluate("""() => {
            const ta = document.querySelector("textarea[aria-label^='Message']"); if (!ta) return null;
            const cs = getComputedStyle(ta, '::placeholder'); return { color: cs.color, size: cs.fontSize };
        }"""))
    attempt(w, "probe-contrast", contrasts)
    print("FAILS:", FAILS)
    browser.close()


# ---- the phone / tablet / other-viewport passes ------------------------------

def viewport_pass(base, pw, platform, theme, lang, account="bob", standalone=False):
    """One platform × theme × language: the screens a person actually walks through."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, account, platform, theme=theme, lang=lang, standalone=standalone)
    p = w.page
    phone = VIEWPORTS[platform][0] < 768
    ids = seed_ids()
    def home():
        t0 = time.time()
        p.goto(base + "/", wait_until="networkidle")
        print("  home timing", w.nav_timing(), "wall %.2fs" % (time.time() - t0))
        w.shot("home")
        w.shot("home-full", full=True)
        diag(w, "home")
    attempt(w, "home", home)
    attempt(w, "login-page", lambda: (p.goto(base + "/login", wait_until="networkidle"), p.wait_for_timeout(500), w.shot("login"), diag(w, "login")))
    def sign_in():
        w.login()
        p.wait_for_timeout(2000)
    attempt(w, "login", sign_in)

    def open_drawer():
        if phone and p.locator(f"button[aria-label='{L(lang, 'shell.pageHeader.openNavigation')}']").count():
            p.click(f"button[aria-label='{L(lang, 'shell.pageHeader.openNavigation')}']")
            p.wait_for_timeout(600)
    # the theme is a stored setting; the language follows the browser locale
    def skin():
        # The language needs nothing: the app follows the browser's locale by default and the context
        # is created with it. Only the theme is a stored setting, and its switch lives in the drawer.
        if theme == "dark":
            return
        open_drawer()
        p.click("[data-testid=user-settings]")
        p.wait_for_timeout(900)
        p.click("[data-nav=appearance]")
        p.wait_for_timeout(700)
        p.locator(f"[role=dialog] [data-theme-choice={theme}], [role=dialog] button:has-text('{theme.capitalize()}')").first.click()
        p.wait_for_timeout(700)
        w.close_settings()
        p.wait_for_timeout(600)
    attempt(w, "skin", skin)
    attempt(w, "friends", lambda: (p.goto(base + "/channels/@me", wait_until="networkidle"), p.wait_for_timeout(1200), w.shot("friends"), diag(w, "friends")))
    def drawer():
        if not phone:
            return
        p.click(f"button[aria-label='{L(lang, 'shell.pageHeader.openNavigation')}']")
        p.wait_for_timeout(700)
        w.shot("drawer")
        diag(w, "drawer")
        print("  drawer side:", p.evaluate("""() => { const a = [...document.querySelectorAll('aside, nav')].map(e => { const r = e.getBoundingClientRect(); return { cls: String(e.className).slice(0,30), x: Math.round(r.x), w: Math.round(r.width) }; }).filter(o => o.w > 40); return a; }"""))
        p.keyboard.press("Escape")
        p.wait_for_timeout(400)
    attempt(w, "drawer", drawer)
    def dm():
        p.goto(base + "/channels/@me", wait_until="networkidle")
        p.wait_for_timeout(1000)
        open_drawer()
        p.locator("button:has(span:text-is('Alice')), button:has(span:text-is('alice'))").first.click()
        p.wait_for_url("**/channels/@me/*", timeout=15000)
        p.wait_for_timeout(2000)
        w.shot("dm")
        diag(w, "dm")
        w.composer().click()
        p.wait_for_timeout(400)
        w.shot("dm-composer-focused")
        w.composer().fill("a message typed on this viewport, long enough to wrap onto a second line in the box")
        p.wait_for_timeout(400)
        w.shot("dm-composer-typed")
        diag(w, "dm-composer")
        w.send("hello from " + platform + " " + theme + " " + lang)
        p.wait_for_timeout(2500)
        w.shot("dm-sent")
    attempt(w, "dm", dm)
    def actions_without_hover():
        row = p.locator("[data-id]").last
        if phone:
            box = row.bounding_box()
            p.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            p.wait_for_timeout(900)
            w.shot("message-tap")
            row.click(button="right")   # stands in for the long press
            p.wait_for_timeout(700)
        else:
            row.click(button="right")
            p.wait_for_timeout(500)
        w.shot("message-actions")
        print("  actions menu:", p.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if p.locator("[role=menu]").count() else "NO MENU")
        diag(w, "message-actions")
        p.keyboard.press("Escape")
    attempt(w, "message-actions", actions_without_hover)
    def server():
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        p.wait_for_selector("[data-id]", timeout=20000)
        p.wait_for_timeout(1500)
        w.shot("server-channel")
        diag(w, "server-channel")
        w.shot("server-channel-full", full=True)
        p.mouse.wheel(0, -1200); p.wait_for_timeout(700); w.shot("server-channel-up")
        p.mouse.wheel(0, -1200); p.wait_for_timeout(700); w.shot("server-channel-top")
    attempt(w, "server", server)
    def members():
        if phone:
            btn = p.locator("button[aria-label*='ember'], button[aria-label*='عضو'], button[aria-label*='itglied']").first
            if btn.count():
                btn.click(); p.wait_for_timeout(800); w.shot("member-list"); diag(w, "member-list"); p.keyboard.press("Escape")
        else:
            w.shot("member-list")
    attempt(w, "members", members)
    def composer_pickers():
        p.click("button[aria-label=\"" + (L(lang, "composer.composer.selectEmoji") or "Select emoji") + "\"]")
        p.wait_for_timeout(1200)
        w.shot("picker-emoji")
        diag(w, "picker-emoji")
        print("  picker box:", p.evaluate("""() => { const d = document.querySelector('[role=dialog]'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), innerH: innerHeight }; }"""))
        p.keyboard.press("Escape")
    attempt(w, "picker", composer_pickers)
    def settings():
        open_drawer()
        p.click("[data-testid=user-settings]")
        p.wait_for_timeout(1200)
        w.shot("settings")
        diag(w, "settings")
        print("  settings nav overflow:", p.evaluate("""() => { const n = document.querySelector('[role=dialog] nav'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), sw: n.scrollWidth, cw: n.clientWidth }; }"""))
        for nav in ("account", "appearance", "privacy", "security", "voice"):
            if p.locator(f"[data-nav={nav}]").count() == 0:
                continue
            p.click(f"[data-nav={nav}]")
            p.wait_for_timeout(800)
            w.shot("settings-" + nav)
            diag(w, "settings-" + nav, small=False)
        p.keyboard.press("Escape")
        p.wait_for_timeout(400)
        p.keyboard.press("Escape")
    attempt(w, "settings", settings)
    def search():
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        p.wait_for_timeout(1200)
        sel = "input[aria-label=\"" + (L(lang, "chat.chat.searchMessages") or "Search messages") + "\"]"
        if p.locator(sel).count() == 0:
            btn = p.locator("button[aria-label=\"" + (L(lang, "chat.chat.searchMessages") or "Search messages") + "\"]")
            if btn.count():
                btn.first.click()
                p.wait_for_timeout(600)
        p.locator(sel).first.click()
        p.wait_for_timeout(800)
        w.shot("search")
        diag(w, "search")
        p.keyboard.type("heading", delay=30)
        p.keyboard.press("Enter")
        p.wait_for_timeout(2500)
        w.shot("search-results")
        diag(w, "search-results", small=False)
        p.keyboard.press("Escape")
    attempt(w, "search", search)
    def reset_skin():
        if theme == "dark":
            return
        open_drawer()
        p.click("[data-testid=user-settings]")
        p.wait_for_timeout(900)
        p.click("[data-nav=appearance]")
        p.wait_for_timeout(700)
        p.locator("[role=dialog] [data-theme-choice=dark], [role=dialog] button:has-text('Dark')").first.click()
        p.wait_for_timeout(700)
        w.close_settings()
    attempt(w, "reset-skin", reset_skin)
    print("FAILS:", FAILS)
    browser.close()


def step_p_dark_en(base, pw):
    viewport_pass(base, pw, "web-phone", "dark", "en")


def step_p_light_en(base, pw):
    viewport_pass(base, pw, "web-phone", "light", "en")


def step_p_dark_ar(base, pw):
    viewport_pass(base, pw, "web-phone", "dark", "ar")


def step_p_dark_de(base, pw):
    viewport_pass(base, pw, "web-phone", "dark", "de")


def step_desktop_light(base, pw):
    viewport_pass(base, pw, "web-desktop", "light", "en")


def step_tablet(base, pw):
    viewport_pass(base, pw, "web-tablet", "dark", "en")


def step_wide(base, pw):
    viewport_pass(base, pw, "web-desktop-1920", "dark", "en")


def step_d7b_voice(base, pw):
    """Voice done properly: the server's voice channel by id (":has-text('General')" also matches
    #general, which is why the first pass never joined a call), both people live, the controls, the
    share-screen modal, the guest link, then a DM call with the callee's page left alone so the ring
    actually reaches it."""
    browser = pw.chromium.launch(args=CHROME_ARGS + ["--auto-select-desktop-capture-source=Entire screen"])
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login(); bob.login()
    a, b = alice.page, bob.page
    a.wait_for_timeout(1200)
    ids = seed_ids()
    def lobby():
        a.goto(base + f"/channels/{ids['server']}/{ids['voice']}", wait_until="networkidle")
        a.wait_for_timeout(2000)
        alice.shot("voice-lobby")
        diag(alice, "voice-lobby")
        print("  join-voice button:", a.locator("[data-testid=join-voice]").count(),
              a.locator("[data-testid=join-voice]").first.inner_text() if a.locator("[data-testid=join-voice]").count() else "")
    attempt(alice, "voice-lobby", lobby)
    def join():
        if a.locator("[data-testid=join-voice]").count():
            a.click("[data-testid=join-voice]")
        else:
            a.locator(f'[data-channel="{ids["voice"]}"]').first.click()
        a.wait_for_timeout(4000)
        alice.shot("voice-joined-alone-2")
        diag(alice, "voice-joined")
        print("  controls aria:", a.locator("[class*=controls]").first.aria_snapshot()[:900] if a.locator("[class*=controls]").count() else "none")
        print("  control sizes:", a.evaluate("""() => [...document.querySelectorAll('[class*=ctl], [class*=sideBtn]')].map(e => { const r = e.getBoundingClientRect(); return { l: (e.getAttribute('aria-label') || '').slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(o => o.w)"""))
        print("  voice status panel:", a.locator("[data-testid=voice-status]").inner_text().replace("\n", " | ")[:200] if a.locator("[data-testid=voice-status]").count() else "none")
    attempt(alice, "voice-join", join)
    def bob_join():
        b.goto(base + f"/channels/{ids['server']}/{ids['voice']}", wait_until="networkidle")
        b.wait_for_timeout(1500)
        if b.locator("[data-testid=join-voice]").count():
            b.click("[data-testid=join-voice]")
        b.wait_for_timeout(5000)
        bob.shot("voice-two-bob")
        alice.shot("voice-two-alice")
        diag(alice, "voice-two")
        print("  tiles:", a.evaluate("() => [...document.querySelectorAll('[class*=tile]')].length"))
    attempt(bob, "voice-join-bob", bob_join)
    def controls():
        for tid, name in (("voice-mute", "muted"), ("voice-mute", "unmuted")):
            a.click(f"[data-testid={tid}]")
            a.wait_for_timeout(700)
            alice.shot("voice-call-" + name)
        for lab in ("Deafen", "Turn on camera"):
            loc = a.locator(f"[class*=controls] button[aria-label='{lab}']")
            if loc.count():
                loc.first.click()
                a.wait_for_timeout(1500)
                alice.shot("voice-call-" + lab.lower().replace(" ", "-"))
        print("  after camera, tiles:", a.evaluate("() => [...document.querySelectorAll('[class*=tile]')].length"))
        b.wait_for_timeout(1200)
        bob.shot("voice-two-bob-camera")
    attempt(alice, "voice-controls", controls)
    def share():
        a.click("[data-testid=screen-share]")
        a.wait_for_timeout(1200)
        alice.shot("share-screen-modal")
        diag(alice, "share-screen")
        print("  share modal:", a.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:500] if a.locator("[role=dialog]").count() else "none")
        if a.locator("[data-testid=go-live]").count():
            a.click("[data-testid=go-live]")
            a.wait_for_timeout(4000)
            alice.shot("voice-sharing")
            b.wait_for_timeout(2500)
            bob.shot("voice-sharing-seen-by-bob")
            diag(bob, "voice-sharing-bob")
    attempt(alice, "voice-share", share)
    def guests():
        if a.locator("[data-testid=invite-guests]").count():
            a.click("[data-testid=invite-guests]")
            a.wait_for_timeout(1500)
            alice.shot("guest-link-modal")
            diag(alice, "guest-link")
            link = a.locator("[data-testid=guest-link]").first
            val = link.input_value() if link.count() else ""
            print("  guest link:", val[:120])
            (SHOTS / "guest.json").write_text(json.dumps({"link": val}))
            a.keyboard.press("Escape")
    attempt(alice, "guest-link", guests)
    def fullscreen():
        a.click("[data-testid=call-fullscreen]")
        a.wait_for_timeout(1200)
        alice.shot("voice-fullscreen")
        a.click("[data-testid=call-fullscreen]")
        a.wait_for_timeout(800)
    attempt(alice, "voice-fullscreen", fullscreen)
    def leave():
        for w, pg in ((alice, a), (bob, b)):
            if pg.locator("[data-testid=voice-leave]").count():
                pg.click("[data-testid=voice-leave]")
                pg.wait_for_timeout(1500)
        alice.shot("voice-after-leave-2")
    attempt(alice, "voice-leave", leave)
    def dm_call():
        # bob opens the DM and is then LEFT ALONE: a goto here drops the ring (it lives in memory only)
        bob.open_dm_from_sidebar("Alice", "alice")
        b.wait_for_timeout(1500)
        alice.open_dm_from_sidebar("Bob", "bob")
        a.wait_for_timeout(1500)
        a.locator("[data-testid=start-call], button[aria-label='Start Voice Call']").first.click()
        a.wait_for_timeout(3000)
        alice.shot("dm-call-ringing-2")
        b.wait_for_timeout(1500)
        bob.shot("incoming-call-2")
        print("  incoming-call modal:", b.locator("[data-testid=incoming-call]").count())
        print("  incoming aria:", b.locator("[data-testid=incoming-call]").first.aria_snapshot()[:500] if b.locator("[data-testid=incoming-call]").count() else "")
        print("  ring button sizes:", b.evaluate("""() => [...document.querySelectorAll('[data-testid=incoming-call] button')].map(e => { const r = e.getBoundingClientRect(); return { l: e.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) }; })"""))
        if b.locator("[data-testid=accept-call]").count():
            b.click("[data-testid=accept-call]")
            b.wait_for_timeout(4000)
            bob.shot("dm-call-connected-bob-2")
            alice.shot("dm-call-connected-2")
            diag(alice, "dm-call")
        for w, pg in ((alice, a), (bob, b)):
            if pg.locator("[data-testid=voice-leave]").count():
                pg.click("[data-testid=voice-leave]")
                pg.wait_for_timeout(1200)
        alice.shot("dm-after-call-2")
        print("  call system message:", a.locator("[data-id]").last.inner_text().replace("\n", " | ")[:200])
    attempt(alice, "dm-call", dm_call)
    def decline():
        a.locator("[data-testid=start-call], button[aria-label='Start Voice Call']").first.click()
        a.wait_for_timeout(2500)
        if b.locator("button[aria-label='Decline']").count():
            b.click("button[aria-label='Decline']")
            b.wait_for_timeout(2000)
            bob.shot("incoming-call-declined-bob")
        a.wait_for_timeout(1500)
        alice.shot("dm-call-declined-caller")
        print("  caller sees:", a.locator("main").inner_text()[-300:].replace("\n", " | "))
        if a.locator("[data-testid=voice-leave]").count():
            a.click("[data-testid=voice-leave]")
    attempt(alice, "dm-call-decline", decline)
    print("FAILS:", FAILS)
    browser.close()


def step_d8_group(base, pw):
    """A group DM: the create-DM modal, a group of three, its header and member list, the edit-group
    modal, the group invite link, adding someone, and what an unnamed group is called."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    carol = Walk(browser, base, "carol", "web-desktop")
    alice.login(); carol.login()
    a, c = alice.page, carol.page
    a.wait_for_timeout(1200)
    def befriend():
        a.goto(base + "/channels/@me", wait_until="networkidle")
        a.wait_for_timeout(800)
        if a.locator("button:has(span:text-is('Carol'))").count() == 0:
            a.click("text=Add Friend")
            a.wait_for_timeout(600)
            a.fill("input[aria-label=Username]", "carol")
            a.click("text=Send Friend Request")
            a.wait_for_timeout(2500)
            c.goto(base + "/channels/@me", wait_until="networkidle")
            c.wait_for_timeout(1200)
            c.click("button:has-text('Pending')")
            c.wait_for_timeout(900)
            carol.shot("friends-pending-carol")
            c.click("button[aria-label=Accept]")
            c.wait_for_timeout(2500)
    attempt(alice, "befriend-carol", befriend)
    def create_group():
        a.goto(base + "/channels/@me", wait_until="networkidle")
        a.wait_for_timeout(1000)
        a.click("button[aria-label='Create DM']")
        a.wait_for_timeout(900)
        alice.shot("create-dm-modal")
        diag(alice, "create-dm-modal")
        print("  create-dm aria:", a.locator("[role=dialog]").first.aria_snapshot()[:900])
        rows = a.locator("[role=dialog] label")
        print("  friend rows:", rows.count())
        for i in range(rows.count()):
            rows.nth(i).locator("input[type=checkbox]").check()
            a.wait_for_timeout(250)
        alice.shot("create-dm-two-picked")
        print("  name field:", a.locator("input[aria-label='Group name (optional)']").count())
        a.fill("input[aria-label='Group name (optional)']", "Weekend plans")
        a.wait_for_timeout(300)
        alice.shot("create-dm-named")
        a.locator("[role=dialog] button:has-text('Create Group DM')").last.click()
        a.wait_for_timeout(3000)
        alice.shot("group-dm")
        diag(alice, "group-dm")
        print("  url:", a.url)
        print("  header:", a.locator("header, [class*=header]").first.inner_text().replace("\n", " | ")[:200])
    attempt(alice, "create-group", create_group)
    def group_bits():
        alice.send("hello group")
        a.wait_for_timeout(2500)
        alice.shot("group-dm-sent")
        for tid, name in (("group-member-list", "members"), ("edit-group", "edit"), ("group-invite-link", "invite")):
            btn = a.locator(f"[data-testid={tid}]")
            print(f"  {tid} present:", btn.count())
        a.locator("[data-testid=chat-more], button[aria-label*='More']").first.click()
        a.wait_for_timeout(700)
        alice.shot("group-dm-menu")
        print("  group menu:", a.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if a.locator("[role=menu]").count() else "none")
        a.keyboard.press("Escape")
    attempt(alice, "group-bits", group_bits)
    def edit_group():
        for label in ("Edit Group", "Group Settings", "Change Icon"):
            if a.locator(f"button:has-text('{label}')").count():
                a.locator(f"button:has-text('{label}')").first.click()
                a.wait_for_timeout(900)
                alice.shot("edit-group-modal")
                diag(alice, "edit-group")
                a.keyboard.press("Escape")
                break
        else:
            print("  no edit-group entry found from the header")
    attempt(alice, "edit-group", edit_group)
    print("FAILS:", FAILS)
    browser.close()


def step_d9_misc(base, pw):
    """App lock and the passcode screen, 2FA setup, data export, the custom status modal, key verify,
    subchats, a very long channel name, an empty channel, and leaving a server."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "carol", "web-desktop")
    w.login()
    p = w.page
    p.wait_for_timeout(1200)
    def security():
        w.open_settings("security")
        p.wait_for_timeout(1200)
        w.shot("settings-security-top")
        print("  security text:", p.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:700])
        p.click("[data-testid=mfa-enable]")
        p.wait_for_timeout(1500)
        w.shot("mfa-setup")
        diag(w, "mfa-setup")
        print("  mfa dialog:", p.locator("[role=dialog]").last.inner_text().replace("\n", " | ")[:500])
        p.keyboard.press("Escape")
        p.wait_for_timeout(500)
    attempt(w, "mfa", security)
    def applock():
        w.open_settings("security")
        p.wait_for_timeout(900)
        p.click("[data-testid=lock-set]")
        p.wait_for_timeout(900)
        w.shot("passcode-set-modal")
        diag(w, "passcode-set")
        p.fill("[data-testid=passcode-new]", "1234")
        p.fill("[data-testid=passcode-confirm]", "1235")
        w.shot("passcode-mismatch")
        p.click("[data-testid=passcode-save]")
        p.wait_for_timeout(1200)
        w.shot("passcode-mismatch-after-save")
        print("  mismatch text:", p.locator("[role=dialog]").last.inner_text().replace("\n", " | ")[:400])
        p.fill("[data-testid=passcode-confirm]", "1234")
        p.click("[data-testid=passcode-save]")
        p.wait_for_timeout(1500)
        w.shot("passcode-set")
        print("  lock row now:", p.locator("[data-testid=lock-row]").inner_text().replace("\n", " | ")[:300] if p.locator("[data-testid=lock-row]").count() else "none")
        p.click("[data-testid=lock-now]")
        p.wait_for_timeout(1800)
        w.shot("passcode-locked")
        diag(w, "passcode-locked")
        print("  lock screen:", p.locator("body").inner_text().replace("\n", " | ")[:400])
        print("  lock tab order:", w.tab_order(6))
        p.fill("[data-testid=passcode-input]", "9999")
        p.click("[data-testid=passcode-submit]")
        p.wait_for_timeout(1500)
        w.shot("passcode-wrong")
        print("  wrong passcode text:", p.locator("body").inner_text().replace("\n", " | ")[:300])
        p.fill("[data-testid=passcode-input]", "1234")
        p.click("[data-testid=passcode-submit]")
        p.wait_for_timeout(2000)
        w.shot("passcode-unlocked")
        # take it off again so the account is usable
        w.open_settings("security")
        p.wait_for_timeout(900)
        if p.locator("[data-testid=lock-remove]").count():
            p.click("[data-testid=lock-remove]")
            p.wait_for_timeout(900)
            w.shot("passcode-remove-confirm")
            p.locator("[role=dialog] button").last.click()
            p.wait_for_timeout(1200)
        w.close_settings()
    attempt(w, "applock", applock)
    def export_data():
        w.open_settings("privacy")
        p.wait_for_timeout(900)
        if p.locator("[data-testid=export-data]").count():
            print("  export button text:", p.locator("[data-testid=export-data]").inner_text())
            p.click("[data-testid=export-data]")
            p.wait_for_timeout(2500)
            w.shot("export-data")
            print("  after export:", p.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[-400:])
        w.close_settings()
    attempt(w, "export", export_data)
    def status():
        p.locator("[data-testid=user-settings]").first.wait_for(timeout=10000)
        p.locator("button:has-text('Carol')").first.click()
        p.wait_for_timeout(900)
        w.shot("user-panel-menu")
        print("  panel menu:", p.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if p.locator("[role=menu]").count() else "none")
        item = p.locator("[role=menu] >> text=/status/i").first
        if item.count():
            item.click()
            p.wait_for_timeout(1000)
            w.shot("custom-status-modal-2")
            diag(w, "custom-status")
            print("  status modal:", p.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:400])
            if p.locator("[data-testid=profile-status]").count():
                p.fill("[data-testid=profile-status]", "away from the keyboard for a while, back later")
                p.wait_for_timeout(400)
                w.shot("custom-status-typed")
            p.keyboard.press("Escape")
    attempt(w, "custom-status", status)
    print("FAILS:", FAILS)
    browser.close()


def step_d10_names(base, pw):
    """Long names and empty rooms: a channel with a very long name, a category, the channel topic modal,
    an empty channel's first-message state, a long display name, and leaving a server."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    alice = Walk(browser, base, "alice", "web-desktop")
    bob = Walk(browser, base, "bob", "web-desktop")
    alice.login(); bob.login()
    a, b = alice.page, bob.page
    ids = seed_ids()
    a.wait_for_timeout(1200)
    def empty_channel():
        a.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        a.wait_for_timeout(1500)
        row = a.locator("[data-channel]:has-text('plans-for-the-weekend')").first
        if row.count():
            row.click()
            a.wait_for_timeout(2000)
            alice.shot("channel-empty-state")
            diag(alice, "channel-empty")
            print("  empty channel text:", a.locator("main").inner_text().replace("\n", " | ")[:400])
    attempt(alice, "empty-channel", empty_channel)
    def long_channel():
        a.click("button[aria-label='Create Channel']")
        a.wait_for_timeout(700)
        a.fill("[data-testid=channel-name]", "a-channel-with-an-extremely-long-name-that-nobody-would-ever-type-but-someone-will")
        a.wait_for_timeout(300)
        alice.shot("create-channel-long-name")
        print("  maxlength:", a.locator("[data-testid=channel-name]").get_attribute("maxlength"),
              "value len:", len(a.locator("[data-testid=channel-name]").input_value()))
        a.click("button:has-text('Create Channel')")
        a.wait_for_timeout(2500)
        alice.shot("sidebar-long-channel")
        print("  url:", a.url)
        diag(alice, "long-channel")
    attempt(alice, "long-channel", long_channel)
    def category_and_topic():
        a.locator("button[aria-label='Create Category'], [role=menu] >> text=Create Category").first.click()
        a.wait_for_timeout(800)
        alice.shot("create-category-modal")
        diag(alice, "create-category")
        inp = a.locator("[role=dialog] input").first
        inp.fill("Weekend Things")
        a.wait_for_timeout(300)
        a.locator("[role=dialog] button").last.click()
        a.wait_for_timeout(2000)
        alice.shot("sidebar-with-category")
    attempt(alice, "category", category_and_topic)
    def channel_settings():
        row = a.locator("[data-channel]").first
        row.hover()
        a.wait_for_timeout(400)
        row.locator("button[aria-label='Edit Channel']").first.click()
        a.wait_for_timeout(1200)
        alice.shot("channel-settings")
        diag(alice, "channel-settings")
        print("  channel settings nav:", a.locator("[role=dialog] nav").first.inner_text().replace("\n", " | ")[:200] if a.locator("[role=dialog] nav").count() else "none")
        print("  channel settings aria:", a.locator("[role=dialog]").first.aria_snapshot()[:1200])
        if a.locator("[data-testid=channel-settings-name]").count():
            a.fill("[data-testid=channel-settings-name]", "General Chat Renamed")
            a.wait_for_timeout(400)
            alice.shot("channel-settings-renamed")
        a.keyboard.press("Escape")
        a.wait_for_timeout(600)
        a.keyboard.press("Escape")
    attempt(alice, "channel-settings", channel_settings)
    def long_display_name():
        alice.open_settings("account")
        a.wait_for_timeout(1000)
        btns = a.locator("[role=dialog] button:has-text('Edit')")
        if btns.count():
            btns.first.click()
            a.wait_for_timeout(800)
            alice.shot("edit-display-name")
            inp = a.locator("[role=dialog] input").last
            inp.fill("Alice Margatroid van der Hoogenbosch III")
            a.wait_for_timeout(300)
            alice.shot("edit-display-name-long")
            print("  maxlength:", inp.get_attribute("maxlength"), "value:", inp.input_value())
            a.locator("[role=dialog] button:has-text('Save')").last.click()
            a.wait_for_timeout(2000)
            alice.shot("account-long-name")
        alice.close_settings()
        a.wait_for_timeout(800)
        a.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        a.wait_for_timeout(2000)
        alice.shot("channel-long-name-everywhere")
        diag(alice, "long-name")
        # put it back: every other pass finds her by the name "Alice"
        alice.open_settings("account")
        a.wait_for_timeout(1000)
        a.locator("[role=dialog] button:has-text('Edit')").first.click()
        a.wait_for_timeout(800)
        a.locator("[role=dialog] input").last.fill("Alice")
        a.locator("[role=dialog] button:has-text('Save')").last.click()
        a.wait_for_timeout(1800)
        alice.close_settings()
        print("  display name restored")
    attempt(alice, "long-display-name", long_display_name)
    def leave_server():
        b.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        b.wait_for_timeout(2000)
        b.click("button:has-text(\"Alice's server\")")
        b.wait_for_timeout(600)
        bob.shot("server-menu-member")
        print("  member's server menu:", b.locator("[role=menu]").first.inner_text().replace("\n", " | ")[:300] if b.locator("[role=menu]").count() else "none")
        item = b.locator("[role=menu] >> text=/Leave/i").first
        if item.count():
            item.click()
            b.wait_for_timeout(900)
            bob.shot("leave-server-confirm")
            print("  leave confirm:", b.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:400])
            b.keyboard.press("Escape")   # do NOT actually leave; the rest of the walk needs bob in
        b.keyboard.press("Escape")
    attempt(bob, "leave-server", leave_server)
    print("FAILS:", FAILS)
    browser.close()


def step_d11_perf(base, pw):
    """Felt performance and the keyboard: cold load, login to a usable chat, channel switch, picker open,
    typing in a long message, scrolling a long channel, and a tab pass over five screens."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "alice", "web-desktop")
    p = w.page
    ids = seed_ids()
    out = {}
    def cold():
        t0 = time.time()
        p.goto(base + "/", wait_until="load")
        out["home"] = w.nav_timing()
        out["home_wall"] = round(time.time() - t0, 2)
        print("  home:", out["home"], out["home_wall"])
        print("  transferred:", p.evaluate("() => performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0)"),
              "requests:", p.evaluate("() => performance.getEntriesByType('resource').length"))
        print("  biggest:", p.evaluate("() => performance.getEntriesByType('resource').map(r => [r.name.split('/').pop().slice(0,40), Math.round(r.transferSize/1024)]).sort((a,b) => b[1]-a[1]).slice(0,8)"))
    attempt(w, "perf-cold", cold)
    def login_to_chat():
        t0 = time.time()
        w.login()
        p.wait_for_url("**/channels/@me", timeout=60000)
        out["login_url"] = round(time.time() - t0, 2)
        p.wait_for_selector("text=Friends", timeout=20000)
        out["login_friends"] = round(time.time() - t0, 2)
        t1 = time.time()
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="commit")
        p.wait_for_selector("[data-id]", timeout=30000)
        out["channel_first_message"] = round(time.time() - t1, 2)
        print("  login:", out)
    attempt(w, "perf-login", login_to_chat)
    def switching():
        chans = p.locator("[data-channel]")
        n = min(chans.count(), 4)
        times = []
        for i in range(n):
            t0 = time.time()
            chans.nth(i).click()
            p.wait_for_timeout(50)
            p.wait_for_function("() => !document.querySelector('[class*=skeleton], [class*=Skeleton]')", timeout=15000)
            times.append(round(time.time() - t0, 2))
        out["channel_switch"] = times
        print("  channel switches:", times)
    attempt(w, "perf-switch", switching)
    def picker():
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        p.wait_for_timeout(1500)
        t0 = time.time()
        p.click("button[aria-label='Select emoji']")
        p.wait_for_selector("[role=dialog]", timeout=15000)
        p.wait_for_timeout(50)
        out["picker_open"] = round(time.time() - t0, 2)
        print("  picker open:", out["picker_open"], "emoji rendered:", p.locator("[role=dialog] button").count())
        p.keyboard.press("Escape")
    attempt(w, "perf-picker", picker)
    def typing():
        box = w.composer()
        box.click()
        box.fill("x" * 1800)
        p.wait_for_timeout(300)
        t0 = time.time()
        p.keyboard.type("the quick brown fox jumps over the lazy dog", delay=0)
        out["type_43_chars_after_1800"] = round(time.time() - t0, 2)
        print("  typing 43 chars into an 1800-char draft:", out["type_43_chars_after_1800"], "s")
        w.shot("composer-1800-chars")
        box.fill("")
        t0 = time.time()
        p.keyboard.type("the quick brown fox jumps over the lazy dog", delay=0)
        out["type_43_chars_empty"] = round(time.time() - t0, 2)
        print("  typing 43 chars into an empty box:", out["type_43_chars_empty"], "s")
        box.fill("")
    attempt(w, "perf-typing", typing)
    def scrolling():
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        p.wait_for_timeout(2000)
        frames = p.evaluate("""async () => {
            const list = [...document.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 300);
            if (!list) return null;
            const times = []; let last = performance.now(); let stop = false;
            const tick = () => { const n = performance.now(); times.push(n - last); last = n; if (!stop) requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            for (let i = 0; i < 40; i++) { list.scrollTop -= 120; await new Promise(r => setTimeout(r, 16)); }
            stop = true;
            const sorted = times.slice(2).sort((a, b) => a - b);
            return { frames: sorted.length, median: Math.round(sorted[Math.floor(sorted.length / 2)]), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), worst: Math.round(sorted[sorted.length - 1]) };
        }""")
        out["scroll_frames_ms"] = frames
        print("  scroll frames:", frames)
    attempt(w, "perf-scroll", scrolling)
    def tabs():
        for name, url in (("friends", "/channels/@me"), ("channel", f"/channels/{ids['server']}/{ids['general']}")):
            p.goto(base + url, wait_until="networkidle")
            p.wait_for_timeout(1500)
            print(f"  --- tab order on {name}:")
            for o in w.tab_order(18):
                print("     ", o)
            w.shot("focus-" + name)
        w.open_settings("account")
        p.wait_for_timeout(1200)
        print("  --- tab order in settings:")
        for o in w.tab_order(14):
            print("     ", o)
        w.shot("focus-settings")
        print("  settings unlabeled:", json.dumps(w.unlabeled())[:600])
        p.keyboard.press("Escape")
    attempt(w, "tab-pass", tabs)
    (SHOTS / "perf.json").write_text(json.dumps(out, indent=1))
    print("PERF", json.dumps(out))
    print("FAILS:", FAILS)
    browser.close()


def step_d12_routes(base, pw):
    """The routes nobody links to: the offline page, a bad URL, the sticker-pack page, a guest call link,
    and the invite page seen by someone who is already a member."""
    browser = pw.chromium.launch(args=CHROME_ARGS)
    w = Walk(browser, base, "bob", "web-desktop")
    p = w.page
    ids = seed_ids()
    def bad_url():
        p.goto(base + "/definitely-not-a-page", wait_until="networkidle")
        p.wait_for_timeout(1200)
        w.shot("route-bad-url-signed-out")
        print("  signed out, bad url ->", p.url, "|", p.locator("body").inner_text().replace("\n", " | ")[:200])
    attempt(w, "bad-url-signed-out", bad_url)
    attempt(w, "login", lambda: (w.login(), p.wait_for_timeout(2000)))
    def bad_url_in():
        p.goto(base + "/definitely-not-a-page", wait_until="networkidle")
        p.wait_for_timeout(1500)
        w.shot("route-bad-url-signed-in")
        print("  signed in, bad url ->", p.url)
        p.goto(base + f"/channels/{ids['server']}/9999999999999999", wait_until="networkidle")
        p.wait_for_timeout(1800)
        w.shot("route-bad-channel")
        print("  bad channel id ->", p.url, "|", p.locator("main").inner_text().replace("\n", " | ")[:250])
        p.goto(base + "/channels/9999999999999999/9999999999999998", wait_until="networkidle")
        p.wait_for_timeout(1800)
        w.shot("route-bad-server")
        print("  bad server id ->", p.url, "|", p.locator("main").inner_text().replace("\n", " | ")[:250])
    attempt(w, "bad-url-signed-in", bad_url_in)
    def offline():
        p.goto(base + f"/channels/{ids['server']}/{ids['general']}", wait_until="networkidle")
        p.wait_for_timeout(1500)
        w.ctx.set_offline(True)
        p.wait_for_timeout(3000)
        w.shot("offline-in-channel")
        print("  offline in channel:", p.locator("body").inner_text().replace("\n", " | ")[:300])
        w.composer().fill("a message typed while offline")
        p.keyboard.press("Enter")
        p.wait_for_timeout(3000)
        w.shot("offline-message-sent")
        print("  offline send:", p.locator("[data-id]").last.inner_text().replace("\n", " | ")[:250],
              "| retry button:", p.locator("[data-testid=retry-send]").count())
        p.reload(wait_until="commit")
        p.wait_for_timeout(4000)
        w.shot("offline-page")
        print("  offline page:", p.locator("body").inner_text().replace("\n", " | ")[:300])
        w.ctx.set_offline(False)
        p.wait_for_timeout(1000)
        if p.locator("[data-testid=offline-retry]").count():
            p.click("[data-testid=offline-retry]")
        p.wait_for_timeout(4000)
        w.shot("offline-recovered")
        print("  after reconnect:", p.url)
    attempt(w, "offline", offline)
    def invite_member():
        link = ids.get("invite")
        if link:
            p.goto(link, wait_until="networkidle")
            p.wait_for_timeout(2500)
            w.shot("invite-page-already-member")
            print("  invite as a member:", p.locator("body").inner_text().replace("\n", " | ")[:300])
    attempt(w, "invite-member", invite_member)
    def guest():
        gp = SHOTS / "guest.json"
        if not gp.exists():
            print("  no guest link recorded (run d7b-voice first)")
            return
        link = json.loads(gp.read_text())["link"]
        if not link:
            print("  guest link empty")
            return
        g = Walk(browser, base, "guest", "web-desktop")
        g.page.goto(link, wait_until="networkidle")
        g.page.wait_for_timeout(2500)
        g.shot("guest-landing")
        diag(g, "guest-landing")
        print("  guest landing:", g.page.locator("body").inner_text().replace("\n", " | ")[:400])
        if g.page.locator("[data-testid=guest-name]").count():
            g.page.fill("[data-testid=guest-name]", "Dana")
            g.page.wait_for_timeout(300)
            g.shot("guest-named")
            g.page.click("[data-testid=guest-join]")
            g.page.wait_for_timeout(5000)
            g.shot("guest-call")
            diag(g, "guest-call")
            print("  guest call:", g.page.locator("body").inner_text().replace("\n", " | ")[:300])
            if g.page.locator("[data-testid=guest-leave]").count():
                g.page.click("[data-testid=guest-leave]")
                g.page.wait_for_timeout(2000)
                g.shot("guest-left")
    attempt(w, "guest-call", guest)
    def stickers():
        w.open_settings("stickers")
        p.wait_for_timeout(1500)
        w.shot("settings-stickers-page")
        diag(w, "stickers")
        print("  stickers page:", p.locator("[role=dialog]").first.inner_text().replace("\n", " | ")[:400])
        w.close_settings()
    attempt(w, "stickers", stickers)
    print("FAILS:", FAILS)
    browser.close()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base = sys.argv[1]
    with sync_playwright() as pw:
        for step in sys.argv[2:]:
            fn = globals().get("step_" + step.replace("-", "_"))
            if not fn:
                print("no such step:", step)
                return 2
            t0 = time.time()
            print(f"== {step}")
            fn(base, pw)
            print(f"== {step} done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
