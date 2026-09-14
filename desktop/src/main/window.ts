/**
 * The app window: the live site in a locked-down renderer. Links to anywhere
 * else open in the default browser, and nothing loaded here but the site gets
 * the desktop bridge.
 */
import { app, BrowserWindow, Menu, clipboard, screen, shell, type ContextMenuParams, type WebContents } from "electron";
import path from "node:path";
import { BASE, ORIGIN, START_URL, isAppUrl } from "./config";
import { windowAudioSupported } from "./appAudio";
import { shareAudioMode } from "./permissions";
import type { SettingsStore } from "./settings";

/** Hands a link to the system, for the web schemes only. */
export function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

const offlinePage = (): string =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5;url=${START_URL}"><title>Evilion Chat</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#2c2d32;color:#f3f3f4;font:16px system-ui,-apple-system,"Segoe UI",sans-serif}
main{text-align:center;max-width:360px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{color:#abacb2;margin:0 0 20px;line-height:1.4}
a{display:inline-block;padding:10px 20px;border-radius:4px;background:#5865f2;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>Can't reach Evilion Chat</h1><p>Check your connection. Trying again in a few seconds.</p><a href="${START_URL}">Try now</a></main></body></html>`);

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
    title: "Evilion Chat",
    autoHideMenuBar: true,
    ...(opts.icon ? { icon: opts.icon } : {}),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      // A chat app works while it is not looked at. Hidden (minimised, in the
      // tray, or covered by another window), Chromium slows a page's timers
      // to once a minute; the connection's heartbeat fell behind, the server
      // hung up, and messages sent meanwhile never raised a notification.
      backgroundThrottling: false,
      // the preload only offers the bridge to pages of this origin
      additionalArguments: [`--evilion-origin=${ORIGIN}`, `--evilion-version=${app.getVersion()}`, `--evilion-share-audio=${shareAudioMode()}`, `--evilion-window-audio=${shareAudioMode() === "own" && windowAudioSupported() ? "1" : "0"}`],
    },
  });
  if (saved?.maximized) win.maximize();

  win.once("ready-to-show", () => {
    if (!opts.hidden) win.show();
  });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url === offlinePage()) return;
    event.preventDefault();
    openExternal(url);
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

  void win.loadURL(START_URL);
  return win;
}

/** The small native menu for text: spelling suggestions, cut, copy and paste. Pages with their own menus never reach it. */
function textMenu(wc: WebContents, p: ContextMenuParams): void {
  const items: Electron.MenuItemConstructorOptions[] = [];
  for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
  if (p.misspelledWord) {
    items.push({ label: "Add to Dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    items.push({ type: "separator" });
  }
  if (p.isEditable) {
    items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" });
  } else if (p.selectionText.trim()) {
    items.push({ role: "copy" });
  }
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Copy Link", click: () => clipboard.writeText(p.linkURL) }, { label: "Open Link in Browser", click: () => openExternal(p.linkURL) });
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
        label: "Evilion Chat",
        submenu: [
          { role: "about" },
          { label: "Check for Updates…", click: checkUpdates },
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
        label: "View",
        submenu: [
          { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win()?.webContents.reload() },
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
