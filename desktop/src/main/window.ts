/**
 * The app window: the live site in a locked-down renderer. Links to anywhere
 * else open in the default browser, and nothing loaded here but the site gets
 * the desktop bridge.
 */
import { app, BrowserWindow, Menu, clipboard, screen, shell, type ContextMenuParams, type WebContents } from "electron";
import path from "node:path";
import { BASE, ORIGIN, START_URL, isAppUrl, isFrameableUrl } from "./config";
import { windowAudioSupported } from "./appAudio";
import { shareAudioMode } from "./permissions";
import { originalWindow, lockOriginalWindow } from "./originalWindow";
import { nativeStrings } from "./strings";
import type { SettingsStore } from "./settings";

/** Hands a link to the system, for the web schemes only. */
export function openExternal(url: string): void {
  try {
    const u = new URL(url);
    // Web schemes only. `mailto:` was here too and nothing in the app ever
    // produces one, so all it offered was a compromised page composing mail
    // with an attacker's recipient, subject and body in the person's own
    // client. Every locally-handled scheme — file:, smb:, ms-msdt:, search-ms:
    // — has always been refused, which is the part that matters.
    if (u.protocol === "https:" || u.protocol === "http:") void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

/** The brand artwork, so the app looks like itself before the site answers. */
const WORDMARK = `<svg viewBox="0 0 229.45 100" width="196" height="85" aria-label="Nexa"><path d="M119.0 20.43 136.82 20.43 136.58 29.22 137.29 31.59 138.95 34.44 144.18 39.19 149.64 34.44 151.78 31.35 152.26 20.43 169.6 20.43 169.6 35.63 156.29 48.69 170.31 63.42 170.31 72.92 168.88 73.4 155.58 76.25 152.02 76.25 152.26 71.02 151.07 66.51 148.22 62.23 144.89 59.38 143.94 59.38 140.38 62.0 137.29 66.75 136.58 69.36 136.82 76.25 118.29 76.01 118.29 63.66 131.83 49.64 119.0 36.1ZM0.0 21.62 40.14 21.62 41.81 22.8 29.45 25.65 50.59 30.17 52.49 38.72 52.49 76.25 33.73 76.25 33.73 66.98 33.73 35.87 18.53 35.87 18.53 76.25 0.0 76.25ZM70.31 21.62 99.52 21.62 104.28 24.23 109.74 29.69 110.93 31.12 110.93 49.64 106.65 55.34 76.96 55.34 76.96 62.71 109.26 62.71 109.26 66.27 109.26 76.25 68.17 76.25 64.13 71.97 58.67 67.7 58.67 34.2 59.62 30.17 80.52 25.65 68.41 22.8ZM180.52 22.09 219.24 22.09 229.45 31.35 229.45 76.72 200.48 76.72 195.96 75.53 181.24 72.45 177.2 52.49 184.09 43.94 211.88 43.94 211.88 35.87 180.52 35.63ZM77.2 34.44 76.96 44.42 92.64 44.42 92.64 34.44ZM195.72 55.34 195.49 63.18 211.64 63.18 211.64 55.34Z" fill="#f3f3f4"/><path d="M54.87 0.0 59.62 20.9 80.52 25.42 59.62 29.93 55.11 50.83 50.36 29.93 29.45 25.65 50.59 20.9ZM176.96 53.21 181.24 72.45 200.48 76.48 181.24 80.76 177.2 100.0 172.92 80.76 153.68 76.72 172.92 72.45Z" fill="#8000ff"/></svg>`;

/**
 * What the window shows while the site loads.
 *
 * Without it the first thing a new install draws is an empty grey rectangle,
 * which reads as a broken app rather than a starting one. This is the same
 * wordmark and the same background the app itself uses, so the seam between
 * the two is hard to see.
 */
const splashPage = (): string =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>Nexa</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#2c2d32}
.mark{animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.55;transform:scale(.99)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.mark{animation:none;opacity:1}}</style></head>
<body><div class="mark">${WORDMARK}</div></body></html>`);

/** Escapes text that goes into the data-URL pages below. */
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const offlinePage = (): string =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5;url=${START_URL}"><title>Nexa</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#2c2d32;color:#f3f3f4;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}
main{text-align:center;max-width:360px;padding:24px}svg{margin:0 auto 20px;display:block}h1{font-size:20px;margin:0 0 8px}p{color:#abacb2;margin:0 0 20px;line-height:1.4}
a{display:inline-block;padding:10px 20px;border-radius:4px;background:#8000ff;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main>${WORDMARK}<h1>${esc(nativeStrings().offlineTitle)}</h1><p>${esc(nativeStrings().offlineBody)}</p><a href="${START_URL}">${esc(nativeStrings().offlineRetry)}</a></main></body></html>`);

export function createMainWindow(settings: SettingsStore, opts: { preload: string; hidden: boolean; icon?: string }): BrowserWindow {
  const saved = settings.get("bounds");
  const onScreen = saved && saved.x !== undefined && saved.y !== undefined && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x! < a.x + a.width - 100 && saved.x! + saved.width > a.x + 100 && saved.y! >= a.y - 20 && saved.y! < a.y + a.height - 100;
  });
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    ...(onScreen ? { x: saved!.x, y: saved!.y } : {}),
    minWidth: 400,
    minHeight: 520,
    show: false,
    backgroundColor: "#2c2d32",
    title: "Nexa",
    autoHideMenuBar: true,
    ...(opts.icon ? { icon: opts.icon } : {}),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      // Hidden (minimised, in the tray, or covered), the page stops drawing
      // and its timers slow down, as a background tab's do: the web app is
      // made for that (its heartbeat runs from a worker). Only a call keeps
      // it at full speed (applyThrottling in index.ts). This must be on
      // when the window is made: a window made without it is never hidden,
      // whatever is set later.
      backgroundThrottling: true,
      // the preload only offers the bridge to pages of this origin
      additionalArguments: [`--evilion-origin=${ORIGIN}`, `--evilion-version=${app.getVersion()}`, `--evilion-share-audio=${shareAudioMode()}`, `--evilion-window-audio=${shareAudioMode() === "own" && windowAudioSupported() ? "1" : "0"}`],
    },
  });
  if (saved?.maximized) win.maximize();

  win.once("ready-to-show", () => {
    if (!opts.hidden) win.show();
    else void putToSleep(win);
  });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    const original = originalWindow(url);
    if (original) return original;
    openExternal(url);
    return { action: "deny" };
  });
  wc.on("did-create-window", (child, details) => lockOriginalWindow(child, details.url));
  wc.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  // `will-navigate` is the main frame's alone. Without this an iframe on the
  // page could go anywhere, and the only thing stopping it was the server's
  // own frame-src — a control that lives on the other side of the wire from
  // the one being defended. It allows what that policy allows and nothing
  // more: being stricter than it here breaks the captcha and every embed
  // without making anything safer.
  wc.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || isFrameableUrl(event.url)) return;
    event.preventDefault();
  });
  wc.on("will-redirect", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  wc.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 is a navigation this app cancelled itself
    if (isMainFrame && code !== -3 && isAppUrl(url)) void wc.loadURL(offlinePage());
  });
  wc.on("context-menu", (_e, params) => textMenu(wc, params));

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const remember = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const b = win.getNormalBounds();
      settings.set({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
    }, 500);
  };
  win.on("resize", remember);
  win.on("move", remember);
  win.on("maximize", remember);
  win.on("unmaximize", remember);

  // The splash is a data URL, so it paints immediately; the site replaces it.
  void win.loadURL(splashPage()).then(() => win.loadURL(START_URL));
  return win;
}

/**
 * A window that has never been shown counts as seen by its page, so a launch
 * straight into the tray (at login) drew and ran at full speed until the
 * window was first opened. Shown for a moment, fully transparent, without
 * focus or a taskbar button, until the page has seen itself shown, and then
 * hidden, it sleeps as any hidden window does. Linux cannot make a window
 * transparent, so there it stays as it was.
 */
async function putToSleep(win: BrowserWindow): Promise<void> {
  if (process.platform === "linux") return;
  const asleep = () => win.webContents.executeJavaScript("document.visibilityState === 'hidden'").catch(() => false);
  win.setOpacity(0);
  win.setSkipTaskbar(true);
  win.showInactive();
  // a hide that comes before the system has finished showing the window is
  // ignored, so it is asked again until the page says it is hidden
  for (let i = 0; i < 40 && !win.isDestroyed(); i++) {
    await new Promise((r) => setTimeout(r, 25));
    // opened from the tray meanwhile: it stays open
    if (win.isDestroyed() || win.isFocused()) break;
    win.hide();
    if (await asleep()) break;
  }
  if (win.isDestroyed()) return;
  win.setOpacity(1);
  win.setSkipTaskbar(false);
}

/** The small native menu for text: spelling suggestions, cut, copy and paste. Pages with their own menus never reach it. */
function textMenu(wc: WebContents, p: ContextMenuParams): void {
  const items: Electron.MenuItemConstructorOptions[] = [];
  for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
  if (p.misspelledWord) {
    items.push({ label: nativeStrings().addToDictionary, click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    items.push({ type: "separator" });
  }
  if (p.isEditable) {
    items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" });
  } else if (p.selectionText.trim()) {
    items.push({ role: "copy" });
  }
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: nativeStrings().copyLink, click: () => clipboard.writeText(p.linkURL) }, { label: nativeStrings().openLinkInBrowser, click: () => openExternal(p.linkURL) });
  }
  if (items.length) Menu.buildFromTemplate(items).popup();
}

/** The macOS menu bar; on Windows and Linux the page is the whole window. */
export function applicationMenu(win: () => BrowserWindow | null, checkUpdates: () => void): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Nexa",
        submenu: [
          { role: "about" },
          { label: `${nativeStrings().checkForUpdates}…`, click: checkUpdates },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: nativeStrings().view,
        submenu: [
          { label: nativeStrings().reload, accelerator: "CmdOrCtrl+R", click: () => win()?.webContents.reload() },
          { role: "togglefullscreen" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

/** An image shipped beside the app: outside the archive when installed, in resources/ while developing. */
export const resourcePath = (name: string): string => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "..", "resources", name));
void BASE;
