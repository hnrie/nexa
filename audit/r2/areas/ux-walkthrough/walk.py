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
    if lang not in _catalogs:
        _catalogs[lang] = json.load(open(ROOT / "web/src/i18n/locales" / f"{lang}.json"))
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
