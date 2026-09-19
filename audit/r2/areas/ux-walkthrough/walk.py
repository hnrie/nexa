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
