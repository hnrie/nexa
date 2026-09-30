"""A guest in a real call through Cloudflare Realtime SFU, on a throwaway local chatd:
alice invites a guest from her voice channel, both hear each other through
end-to-end encrypted frames, the guest can reach nothing but the call, and after
alice rotates the server's key mid-call the guest still hears her, on keys the
call handed over, then alice removes the guest.

Needs REALTIME_APP_ID/SECRET and TURN_KEY_ID/API_TOKEN in chatd.env (commented
lines count), and passes only those four to the test server. Two browsers and a
minute or two of real SFU audio. Like e2e.py it tests bin/chatd and web/dist
unless E2E_CHATD / E2E_WEB_DIST say otherwise.
"""
import json, os, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = {}
for line in open(ROOT / "chatd.env"):
    m = re.match(r"#?\s*([A-Z_]+)=(.*)", line.strip())
    if m and m.group(2):
        env[m.group(1)] = m.group(2)
for k in ("REALTIME_APP_ID", "REALTIME_APP_SECRET", "TURN_KEY_ID", "TURN_API_TOKEN"):
    if k not in env:
        sys.exit(f"{k} is not in chatd.env")
    os.environ[k] = env[k]
sys.path.insert(0, str(ROOT / "tools"))
sys.argv = [sys.argv[0]]
from e2e import Server, Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "tools/out/sfu-guest"
OUT.mkdir(parents=True, exist_ok=True)
failures = []

# counts the frames the call's crypto worker seals and opens, and the relayed keys a page receives
PATCH = """
(() => {
  const NativeWorker = window.Worker;
  function PatchedWorker(url, opts) {
    const w = new NativeWorker(url, opts);
    if (String(url).includes("frameCrypto")) w.addEventListener("message", (e) => { if (e.data && e.data.type === "stats") window.__frameStats = e.data; });
    return w;
  }
  PatchedWorker.prototype = NativeWorker.prototype;
  window.Worker = PatchedWorker;
  window.__relays = 0;
  const NativeWS = window.WebSocket;
  function PatchedWS(...args) {
    const ws = new NativeWS(...args);
    ws.addEventListener("message", (e) => { if (typeof e.data === "string" && e.data.includes('"guest_keys"')) window.__relays++; });
    return ws;
  }
  PatchedWS.prototype = NativeWS.prototype;
  Object.assign(PatchedWS, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = PatchedWS;
})();
"""

LEVEL = """
async ([userId]) => {
  const el = document.querySelector(`audio[data-voice-peer='${userId}']`);
  if (!el || !el.srcObject) return { el: false };
  const held = el.getAttribute('data-held');
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(el.srcObject);
  const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    peak = Math.max(peak, Math.sqrt(sum / buf.length));
  }
  src.disconnect(); await ctx.close();
  return { el: true, peak, held };
}
"""


def check(cond, what):
    print(("  ok   " if cond else "  FAIL ") + what, flush=True)
    if not cond:
        failures.append(what)


def api(page, method, path, body=None, token=None):
    return page.evaluate(
        """async ([method, path, body, token]) => {
          const res = await fetch('/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + (token || localStorage.getItem('ec.token')), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
          let json = null; try { json = await res.json(); } catch {}
          return { status: res.status, body: json };
        }""",
        [method, path, body, token],
    )


def level(page, uid):
    return page.evaluate(LEVEL, [uid])


def hears(page, uid, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        lv = level(page, uid)
        if (lv.get("peak") or 0) > 0.01 and lv.get("held") != "true":
            return True
        page.wait_for_timeout(500)
    return False


srv = Server()
print("chatd dir:", srv.dir, flush=True)
errors = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        alice = Session(b, srv.base, "alice", OUT)
        alice.page.add_init_script(PATCH)
        alice.register("Alice")
        a = alice.page
        a.goto(srv.base + "/channels/@me", wait_until="networkidle")
        a.click("button[aria-label='Add a Server']")
        a.fill("[data-testid=server-name]", "Calls")
        a.click("[role=dialog] button:has-text('Create')")
        a.wait_for_selector("textarea[aria-label='Message #general']", timeout=20000)
        server_id = a.url.split("/channels/")[1].split("/")[0]
        alice_id = api(a, "GET", "/users/@me")["body"]["id"]
        a.locator("[data-channel]:has(span:text-is('General')) button").first.click()
        a.wait_for_selector("[data-testid=voice-status]", timeout=30000)
        voice_id = a.url.rstrip("/").split("/")[-1]

        print("== alice invites a guest from the call", flush=True)
        a.click("[data-testid=invite-guests]")
        box = a.locator("[data-testid=guest-link]")
        box.wait_for(timeout=15000)
        link = ""
        for _ in range(100):
            link = box.input_value()
            if "#k=" in link:
                break
            time.sleep(0.1)
        check("/call/" in link and "#k=" in link, "the link carries the call's key in its fragment")
        a.keyboard.press("Escape")

        gctx = b.new_context(viewport={"width": 1280, "height": 800}, permissions=["microphone", "camera"])
        g = gctx.new_page()
        g.add_init_script(PATCH)
        g.on("pageerror", lambda e: errors.append(f"guest: {e}"))
        g.goto(link, wait_until="networkidle")
        g.fill("[data-testid=guest-name]", "Visitor")
        g.click("[data-testid=guest-join]")
        g.wait_for_selector("[data-testid=guest-call]", timeout=30000)
        code = link.split("/call/")[1].split("#")[0]
        stay = json.loads(g.evaluate(f"() => sessionStorage.getItem('ec.guest.{code}')"))
        gid, token = stay["guest"]["id"], stay["token"]
        check(stay["guest"]["sfu"] is True, "the guest's call goes through the SFU")

        print("== both hear each other through encrypted frames", flush=True)
        check(hears(g, alice_id, 45), f"the guest hears alice: {level(g, alice_id)}")
        check(hears(a, gid, 30), f"alice hears the guest: {level(a, gid)}")
        gf = g.evaluate("() => window.__frameStats")
        check(bool(gf) and gf.get("sealed", 0) > 0 and gf.get("opened", 0) > 0, f"the guest's frames are sealed and opened: {gf}")
        for path in ("/users/@me", "/users/@me/channels", f"/channels/{voice_id}/messages", f"/servers/{server_id}"):
            st = api(g, "GET", path, token=token)["status"]
            check(st == 401, f"guest GET {path} -> {st}")
        alice.shot("with-guest")
        g.screenshot(path=str(OUT / "guest-view.png"))

        print("== alice rotates the server's key mid-call", flush=True)
        before = api(a, "GET", f"/keys/epochs?conv_id={server_id}")["body"]
        a.locator("button[aria-haspopup=menu]:has-text('Calls')").first.click()
        a.click("text=Server Settings")
        a.click("[data-nav=encryption]")
        a.locator("button:has-text('Rotate')").first.click()
        a.wait_for_timeout(2500)
        after = api(a, "GET", f"/keys/epochs?conv_id={server_id}")["body"]
        print("  epochs:", json.dumps(before)[:200], "->", json.dumps(after)[:200], flush=True)
        a.keyboard.press("Escape")
        # alice's call picks the new key up within a few seconds, and hands it to the guest
        g.wait_for_function("() => window.__relays > 0", timeout=30000)
        check(True, f"the guest was handed the new key ({g.evaluate('() => window.__relays')} relays)")
        a.wait_for_timeout(8000)
        check(hears(g, alice_id, 30), f"after the rotation the guest still hears alice: {level(g, alice_id)}")
        check(hears(a, gid, 30), f"and alice the guest: {level(a, gid)}")
        gf2 = g.evaluate("() => window.__frameStats")
        print("  guest frames:", gf2, flush=True)

        print("== alice removes the guest", flush=True)
        r = api(a, "DELETE", f"/channels/{voice_id}/guests/{gid}")
        check(r["status"] == 204, f"remove: {r['status']}")
        g.wait_for_selector("text=You were removed from the call.", timeout=15000)
        check(True, "the guest is told")
        errors += alice.errors
        b.close()
finally:
    srv.stop()
print("page errors:", errors or "none")
print("FAILURES:", failures or "none")
sys.exit(1 if failures or errors else 0)
