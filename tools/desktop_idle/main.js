// Runs the desktop app's built main process (muted, no tray icon, no
// system-wide keys; desktop_idle.py turns Rich Presence off in its settings,
// so it never takes Discord's socket from a Nexa already running), then test.js.
// The deadline is set before anything else loads, so nothing can keep it open.
const DEADLINE_S = 120 + Number(process.env.T_LONG || 0);
setTimeout(() => { console.log(`[t] TIMEOUT after ${DEADLINE_S}s at: ${global.__step}`); process.exit(2); }, DEADLINE_S * 1000).unref();
const Module = require("node:module");
const real = require("electron");
real.app.commandLine.appendSwitch("mute-audio");
class Win extends real.BrowserWindow {
  static made = [];
  constructor(o = {}) {
    super(o);
    this.webContents.setAudioMuted(true);
    Win.made.push(this);
  }
}
class FakeTray { setToolTip() {} setContextMenu() {} on() { return this; } setImage() {} destroy() {} setTitle() {} setIgnoreDoubleClickEvents() {} }
const shortcuts = { register: () => true, unregister() {}, unregisterAll() {}, isRegistered: () => false };
const proxy = new Proxy(real, { get: (t, k) => (k === "BrowserWindow" ? Win : k === "Tray" ? FakeTray : k === "globalShortcut" ? shortcuts : t[k]) });
const load = Module._load;
Module._load = function (req, ...rest) { return req === "electron" ? proxy : load.call(this, req, ...rest); };
process.on("unhandledRejection", (e) => { console.log(`[t] FAIL unhandled: ${e?.stack || e}`); process.exit(1); });
require(process.env.APP_MAIN);
real.app.whenReady().then(() => require("./test.js")(real, Win));
