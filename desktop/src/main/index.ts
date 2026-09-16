/**
 * nexa for the desktop: one window on the live site, a tray icon, the
 * Rich Presence server, and updates.
 */
import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC, type DesktopSettings, type Identity, type WindowState } from "../shared/bridge";
import { BASE, ORIGIN, isAppUrl } from "./config";
import { chooseDisplaySource, handleDisplayMedia, lockPermissions, shareAudioFailed } from "./permissions";
import { RpcService } from "./rpc/service";
import { SettingsStore } from "./settings";
import { createTray } from "./tray";
import { Updater } from "./update";
import { applicationMenu, createMainWindow, resourcePath } from "./window";

// tests run the app with a profile of their own
if (process.env.EVILION_USER_DATA) app.setPath("userData", process.env.EVILION_USER_DATA);
const settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
if (!settings.get("hardwareAcceleration")) app.disableHardwareAcceleration();
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
if (process.platform === "win32") app.setAppUserModelId("xyz.evilion.chat");

const log = (msg: string, extra?: Record<string, unknown>) => {
  if (!app.isPackaged || process.env.EVILION_DEBUG) console.log(`[evilion] ${msg}`, extra ?? "");
};

let win: BrowserWindow | null = null;
let quitting = false;
let identity: Identity | null = null;
let rpc: RpcService | null = null;
let updater: Updater | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  void app.whenReady().then(start);
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Sends to the page while there is one: a window closing to quit has none. */
function toPage(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

/** Only the site's own page, in this window, may use the bridge. */
function fromApp(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && isAppUrl(e.senderFrame?.url);
}

async function start(): Promise<void> {
  lockPermissions();
  // opened at login: Windows passes the argument given below, macOS says so itself
  const launchedHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true);
  win = createMainWindow(settings, {
    preload: path.join(__dirname, "preload.js"),
    hidden: launchedHidden && settings.get("startMinimized"),
    ...(process.platform === "linux" ? { icon: resourcePath("icon.png") } : {}),
  });
  handleDisplayMedia(() => win, log);
  applicationMenu(() => win, () => void updater?.check());

  win.on("close", (e) => {
    if (quitting || !settings.get("closeToTray")) return;
    e.preventDefault();
    win?.hide();
  });
  // Windows signing out or shutting down closes the window itself; the tray must not hold that up
  win.on("session-end", () => {
    quitting = true;
  });
  win.on("closed", () => {
    win = null;
  });
  // the page decides whether to notify from this rather than document.hasFocus()
  for (const event of ["focus", "blur", "show", "hide", "minimize", "restore"] as const) win.on(event as "focus", () => toPage(IPC.windowState, windowState()));

  createTray({
    show: showWindow,
    mute: () => toPage(IPC.trayAction, "mute"),
    deafen: () => toPage(IPC.trayAction, "deafen"),
    checkUpdates: () => void updater?.check(),
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  applyLoginItem(settings.get("launchAtLogin"));

  rpc = new RpcService({
    enabled: settings.get("rpcEnabled"),
    relay: settings.get("rpcRelay"),
    hidden: settings.get("hiddenApps"),
    leftoverMove: settings.get("movedSocket"),
    rememberMove: (m) => settings.set({ movedSocket: m }, { now: true }),
    identity: () => identity,
    log,
  });
  rpc.on("state", (state) => toPage(IPC.rpcState, state));
  rpc.on("activities", (list) => toPage(IPC.activities, list));
  void rpc.start().catch((err) => log("rpc start failed", { err: String(err) }));

  updater = new Updater(new URL("/desktop/", BASE).toString(), new URL("/download", BASE).toString(), quitForUpdate, log);
  updater.on("state", (s) => toPage(IPC.updateState, s));
  updater.start();

  // a laptop waking up may have missed Discord starting or quitting
  powerMonitor.on("resume", () => void rpc?.refreshDiscord().then((s) => toPage(IPC.rpcState, s)));

  registerIpc();
  log("started", { origin: ORIGIN });
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromApp(e)) throw new Error("not allowed");
      return fn(...(args as A));
    });
  const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void) =>
    ipcMain.on(channel, (e, ...args) => {
      if (fromApp(e)) fn(...(args as A));
    });

  handle(IPC.rpcGetState, () => rpc!.refreshDiscord());
  handle(IPC.rpcSetEnabled, async (enabled: boolean) => {
    settings.set({ rpcEnabled: !!enabled });
    await rpc!.setEnabled(!!enabled);
  });
  handle(IPC.rpcSetRelay, (relay: boolean) => {
    settings.set({ rpcRelay: !!relay });
    rpc!.setRelay(!!relay);
  });
  handle(IPC.rpcSetHidden, (clientId: string, hidden: boolean) => {
    if (!/^\d{1,20}$/.test(String(clientId))) return;
    rpc!.setHidden(String(clientId), !!hidden);
    settings.set({ hiddenApps: rpc!.hiddenApps() });
  });
  handle(IPC.rpcRestartDiscord, () => rpc!.restartDiscord());
  on(IPC.setIdentity, (user: Identity | null) => {
    identity = user && typeof user.id === "string" ? user : null;
  });

  handle(IPC.updateGetState, () => updater!.state);
  handle(IPC.updateCheck, () => updater!.check());
  handle(IPC.updateRestart, () => updater!.restart());

  handle(IPC.settingsGet, (): DesktopSettings => desktopSettings());
  handle(IPC.settingsSet, (patch: Partial<DesktopSettings>): DesktopSettings => {
    const next: Partial<DesktopSettings> = {};
    for (const key of ["launchAtLogin", "startMinimized", "closeToTray", "hardwareAcceleration"] as const) {
      if (typeof patch?.[key] === "boolean") next[key] = patch[key];
    }
    settings.set(next, { now: true });
    if (next.launchAtLogin !== undefined || next.startMinimized !== undefined) applyLoginItem(settings.get("launchAtLogin"));
    return desktopSettings();
  });

  on(IPC.setBadge, (count: number) => setBadge(Math.max(0, Math.floor(Number(count) || 0))));
  // the window is never slowed down in the background any more (see createMainWindow), in a call or not
  on(IPC.setCallActive, () => {});
  // a notification clicked while the window sits in the tray or minimised brings it back
  on(IPC.focusWindow, () => showWindow());
  on(IPC.requestAttention, () => requestAttention());
  handle(IPC.windowGetState, () => windowState());
  handle(IPC.shareAudioFailed, () => shareAudioFailed(log));
  on(IPC.displayChoose, (requestId: string, sourceId: string | null, withAudio: boolean) => chooseDisplaySource(String(requestId), sourceId === null ? null : String(sourceId), !!withAudio));
}

/**
 * Draws the eye to a notification the way the system does, while the window
 * is not being looked at: the taskbar button flashes on Windows (and Linux
 * where the window manager supports it) until the window is focused, and the
 * Dock icon bounces once on macOS.
 */
function requestAttention(): void {
  if (!win || win.isDestroyed() || win.isFocused()) return;
  if (process.platform === "darwin") {
    app.dock?.bounce("informational");
    return;
  }
  win.flashFrame(true);
  const w = win;
  w.once("focus", () => {
    if (!w.isDestroyed()) w.flashFrame(false);
  });
}

function windowState(): WindowState {
  if (!win || win.isDestroyed()) return { focused: false, visible: false, minimized: false };
  return { focused: win.isFocused(), visible: win.isVisible(), minimized: win.isMinimized() };
}

function desktopSettings(): DesktopSettings {
  return {
    launchAtLogin: settings.get("launchAtLogin"),
    startMinimized: settings.get("startMinimized"),
    closeToTray: settings.get("closeToTray"),
    hardwareAcceleration: settings.get("hardwareAcceleration"),
  };
}

function applyLoginItem(on: boolean): void {
  // a development build, or one under test, must not put itself in the login items
  if (!app.isPackaged || process.env.EVILION_NO_LOGIN_ITEM) return;
  if (process.platform === "linux") {
    linuxAutostart(on);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
}

/** Linux desktops start what is in ~/.config/autostart when someone signs in. */
function linuxAutostart(on: boolean): void {
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config"), "autostart");
  const file = path.join(dir, "nexa.desktop");
  try {
    if (!on) {
      fs.rmSync(file, { force: true });
      return;
    }
    // an AppImage is started through its own file, not the mount it unpacks to
    const exec = (process.env.APPIMAGE || process.execPath).replace(/(["\\`$])/g, "\\$1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=nexa\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
  } catch (err) {
    log("autostart", { err: String(err) });
  }
}

let badgeImage: Electron.NativeImage | null = null;
function setBadge(count: number): void {
  if (process.platform === "win32") {
    badgeImage ??= nativeImage.createFromPath(resourcePath("badge.png"));
    win?.setOverlayIcon(count > 0 ? badgeImage : null, count > 0 ? `${count} unread` : "");
    return;
  }
  app.setBadgeCount(count);
}

/**
 * Stops Rich Presence once, so Discord's socket goes back to its own name
 * before the process ends. It never waits: a quit held up to wait for it never
 * finished when the system was the one ending the app (a shutdown, a logout,
 * a kill), and the app stayed running.
 */
function stopRpc(): void {
  const stopping = rpc;
  rpc = null;
  try {
    stopping?.stopForExit();
  } catch (err) {
    log("rpc stop failed", { err: String(err) });
  }
}

function quitForUpdate(install: () => void): void {
  log("quitting to update");
  quitting = true;
  stopRpc();
  settings.flush();
  install();
}

app.on("activate", () => showWindow());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  stopRpc();
  settings.flush();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
