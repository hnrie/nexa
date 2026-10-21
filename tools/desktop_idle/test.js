// The checks tools/desktop_idle.py runs inside the desktop app (see main.js):
// a hidden window sleeps, a call keeps it at full speed, a message still
// notifies and sounds, and a launch into the tray sleeps from the start.
const BASE = process.env.EVILION_URL, SERVER = process.env.T_SERVER, CHAN = process.env.T_CHAN;
const LONG = Number(process.env.T_LONG || 0);
const PW = "correct horse battery staple";
const BOX = `document.querySelector("textarea[aria-label^='Message']")`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
let ok = true;
const log = (s) => console.log(`[t ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const check = (label, cond, detail = "") => { ok &&= !!cond; log(`${cond ? "PASS" : "FAIL"} ${label} ${detail}`); };
async function until(what, fn, ms = 20_000) {
  global.__step = what;
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* page between loads */ }
    if (Date.now() > end) throw new Error(`gave up waiting for: ${what}`);
    await sleep(100);
  }
}
const js = (w, code) => w.webContents.executeJavaScript(code);
async function signIn(w, name) {
  await until(`${name}: a page of the site`, async () => w.webContents.getURL().startsWith(BASE) && (await js(w, "document.readyState")) === "complete");
  const where = await until(`${name}: sign-in or the app`, async () => {
    const p = await js(w, "location.pathname");
    if (p.startsWith("/login")) return (await js(w, "!!document.querySelector('input[type=password]')")) && "login";
    return p.startsWith("/channels") && "in";
  });
  if (where === "login") {
    await js(w, `(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(document.querySelector("input[autocomplete=username]"), ${JSON.stringify(name)}); set(document.querySelector("input[type=password]"), ${JSON.stringify(PW)});
      document.querySelector("button[type=submit]").click(); })()`);
    await until(`${name}: signed in`, async () => (await js(w, "location.pathname")).startsWith("/channels"), 60_000);
    await sleep(1500);
    await js(w, `(() => { const g = document.querySelector("[data-testid=terms-gate]"); if (!g) return; g.querySelectorAll("input[type=checkbox]").forEach((c) => c.checked || c.click()); [...g.querySelectorAll("button")].pop().click(); })()`);
  }
}
async function openChannel(w) {
  await w.loadURL(`${BASE}/channels/${SERVER}/${CHAN}`);
  await until("the channel's message box", () => js(w, `!!${BOX}`), 30_000);
}
// counts timers and frames, catches notifications, and puts something moving on the page
const INSTR = `(() => { window.__ticks = 0; setInterval(() => __ticks++, 100); window.__raf = 0; (function f() { __raf++; requestAnimationFrame(f); })();
  window.__played = []; for (const C of [AudioBufferSourceNode, OscillatorNode]) { const o = C.prototype.start; C.prototype.start = function (...a) { __played.push(this.context.state); return o.apply(this, a); }; }
  window.__notes = []; const N = function (t, o) { __notes.push(t + ": " + (o && o.body)); this.close = () => {}; }; N.permission = "granted"; N.requestPermission = async () => "granted"; window.Notification = N;
  const d = document.createElement("div"); d.style.cssText = "position:fixed;left:10px;top:10px;width:40px;height:40px;background:#8000ff;animation:tspin 1s linear infinite;z-index:99999";
  const s = document.createElement("style"); s.textContent = "@keyframes tspin{to{transform:rotate(360deg)}}"; document.head.append(s); document.body.append(d); return !!window.evilionDesktop; })()`;

const probeOf = async (win) => {
  await sleep(300);
  const a = await js(win, "[document.visibilityState, __ticks, __raf]"); await sleep(600); const b = await js(win, "[document.visibilityState, __ticks, __raf]");
  return { vis: b[0], timers: b[1] - a[1], frames: b[2] - a[2] };
};
module.exports = async ({ app }, Win) => {
  let win;
  const asleepAt = async (label) => { const s = await probeOf(win); check(label, s.vis === "hidden" && s.timers <= 1 && s.frames === 0, JSON.stringify(s)); };
  const awakeAt = async (label) => { const s = await probeOf(win); check(label, s.vis === "visible" && s.timers >= 5 && s.frames > 0, JSON.stringify(s)); };
  try {
    win = await until("the app's window", () => Win.made[0]);
    if (process.env.T_MODE === "hidden") {
      // started into the tray: the page loads and sleeps without ever being opened
      await until("the page loaded in the tray", async () => win.webContents.getURL().startsWith(BASE) && (await js(win, "document.readyState")) === "complete", 30_000);
      await sleep(1500);
      await js(win, INSTR);
      check("started hidden: the window is not shown", !win.isVisible() && win.getOpacity() === 1);
      await asleepAt("started in the tray: asleep without ever being opened");
      win.show(); await until("shown", () => win.isVisible(), 5000); await sleep(500);
      await awakeAt("opened from the tray: awake and drawn");
      check("  and fully opaque", win.getOpacity() === 1);
      log(ok ? "ALL PASS" : "SOME FAILED");
      return app.exit(ok ? 0 : 1);
    }
    await signIn(win, "alice");
    await openChannel(win);
    check("the page has the desktop bridge", await js(win, INSTR));
    const call = (on) => js(win, `window.evilionDesktop.setCallActive(${on}), 1`);
    const probe = async () => {
      await sleep(300);
      const a = await js(win, "[document.visibilityState, __ticks, __raf]"); await sleep(600); const b = await js(win, "[document.visibilityState, __ticks, __raf]");
      return { vis: b[0], timers: b[1] - a[1], frames: b[2] - a[2] };
    };
    const asleep = async (label) => { global.__step = label; const s = await probe(); check(label, s.vis === "hidden" && s.timers <= 1 && s.frames === 0, JSON.stringify(s)); };
    const awake = async (label) => { global.__step = label; const s = await probe(); check(label, s.timers >= 5, JSON.stringify(s)); };
    const minimize = async () => { win.minimize(); await until("minimized", () => win.isMinimized(), 5000); await sleep(500); };
    const restore = async () => { win.restore(); await until("restored", () => !win.isMinimized() && win.isVisible(), 5000); await sleep(500); };
    const show = async () => { win.show(); await until("shown", () => win.isVisible(), 5000); await sleep(300); };
    const reloaded = async (label) => {
      win.webContents.reload();
      await until("reloaded", async () => (await js(win, "typeof window.__ticks")) === "undefined", 10_000);
      await until("the reloaded page's message box", () => js(win, `!!${BOX}`), 30_000);
      await js(win, INSTR); win.hide(); await asleep(label);
    };

    await show(); await awake("shown: awake");
    win.hide(); await asleep("tray, no call: asleep");
    await show(); await minimize(); await asleep("minimized, no call: asleep");
    await restore(); await call(true); win.hide(); await awake("in a call, tray: full speed");
    await call(false); await awake("call ends in the tray: awake until shown again");
    await show(); win.hide(); await asleep("  shown and hidden again: asleep");
    await call(true); await awake("call starts while in the tray: full speed");
    await show(); await minimize(); await awake("in a call, minimized: full speed");
    await call(false); await restore(); await minimize(); await asleep("call ended, restored, minimized: asleep");
    await restore(); await reloaded("a reload, then the tray: asleep");
    await show(); await call(true); await reloaded("a reload mid-call lets it sleep again");

    // a message to a page asleep in the tray raises its notification
    const bob = new Win({ show: false, width: 1366, height: 768, webPreferences: { partition: "persist:bob" } });
    await bob.loadURL(`${BASE}/login`);
    await signIn(bob, "bob");
    await openChannel(bob);
    if (LONG) { log(`   asleep in the tray for ${LONG}s`); global.__step = "the long sleep"; await sleep(LONG * 1000); }
    const text = `while you were away ${Date.now()}`;
    await js(bob, `${BOX}.focus()`);
    bob.webContents.insertText(text);
    await sleep(200);
    for (const type of ["keyDown", "char", "keyUp"]) bob.webContents.sendInputEvent({ type, keyCode: type === "char" ? "\r" : "Return" });
    const sent = Date.now();
    const note = await until("the notification", async () => { const n = await js(win, "__notes.join(' | ')"); return n.includes(text) && n; }, 30_000).catch(() => null);
    check(`a message to the sleeping page notifies in ${((Date.now() - sent) / 1000).toFixed(1)}s`, note, note ?? "");
    await sleep(1500);
    const played = await js(win, "__played");
    check("  its sound played, on audio that had been resting", played.length > 0 && played.every((st) => st === "running"), JSON.stringify(played));
    check("  and the page stayed asleep", (await js(win, "document.visibilityState")) === "hidden");
  } catch (e) {
    ok = false;
    log(`FAIL at "${global.__step}": ${e.message}`);
  }
  log(ok ? "ALL PASS" : "SOME FAILED");
  app.exit(ok ? 0 : 1);
};
