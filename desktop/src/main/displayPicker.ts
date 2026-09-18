/**
 * The window that asks which screen to share.
 *
 * It used to be drawn by the page. `setDisplayMediaRequestHandler` sent the
 * whole list of screens and windows down to the renderer and waited for it to
 * send back an id, so the page both made the request and answered it: anything
 * with script execution there could call `getDisplayMedia`, catch its own
 * event, reply "screen:0" and have a full-screen video track with system audio
 * without a pixel ever being drawn. `display-capture` is auto-granted, so
 * there was no second gate. The only signals were the window coming forward
 * and, on macOS, the system recording dot.
 *
 * So the picker is a window of its own: a modal `BrowserWindow` on a `file:`
 * page, with its own sandboxed preload, which the site's renderer cannot
 * script, cannot see, and cannot answer for. Its origin is not the app's, so
 * every permission handler denies it, which is correct — it needs none.
 *
 * What it is not: the operating system's own picker. The reasoning for that is
 * in permissions.ts and has not changed — in Electron it is experimental, and
 * a window picked in it could come back as the whole screen.
 */
import { BrowserWindow, ipcMain, nativeTheme, type BrowserWindow as Win } from "electron";
import path from "node:path";
import type { DisplaySource } from "../shared/bridge";

export interface PickerAnswer {
  sourceId: string;
  withAudio: boolean;
}

const CHANNEL = {
  ready: "picker:ready",
  choose: "picker:choose",
  cancel: "picker:cancel",
} as const;

let open: Win | null = null;

/**
 * Asks which of `sources` to share, and whether to carry its sound.
 *
 * Resolves with null if the person cancelled, closed the window, or did not
 * answer inside `timeoutMs`. Only one picker exists at a time: a second
 * request while one is open is refused rather than stacking a window the
 * person did not ask for.
 */
export function askForDisplaySource(
  parent: Win,
  sources: DisplaySource[],
  opts: { audio: boolean; timeoutMs?: number },
): Promise<PickerAnswer | null> {
  if (open) return Promise.resolve(null);

  const win = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: 860,
    height: 600,
    minWidth: 520,
    minHeight: 420,
    title: "Choose what to share",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1b1f" : "#ffffff",
    autoHideMenuBar: true,
    // A page that loads nothing from anywhere needs nothing from Node, and the
    // preload below is the whole of what it can reach.
    webPreferences: {
      preload: path.join(__dirname, "pickerPreload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      spellcheck: false,
    },
  });
  open = win;

  return new Promise<PickerAnswer | null>((resolve) => {
    let done = false;
    const finish = (answer: PickerAnswer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ipcMain.removeListener(CHANNEL.ready, onReady);
      ipcMain.removeListener(CHANNEL.choose, onChoose);
      ipcMain.removeListener(CHANNEL.cancel, onCancel);
      open = null;
      if (!win.isDestroyed()) win.destroy();
      resolve(answer);
    };

    /** Only this window's own messages count; nothing else may answer for it. */
    const mine = (event: Electron.IpcMainEvent): boolean => !win.isDestroyed() && event.sender === win.webContents;

    const onReady = (event: Electron.IpcMainEvent) => {
      if (!mine(event)) return;
      event.sender.send(CHANNEL.ready, { sources, audio: opts.audio, dark: nativeTheme.shouldUseDarkColors });
      win.show();
      win.focus();
    };
    const onChoose = (event: Electron.IpcMainEvent, payload: unknown) => {
      if (!mine(event)) return;
      const answer = payload as Partial<PickerAnswer> | null;
      // The id has to be one of the ones offered. The page cannot reach this
      // channel, but a picker that trusts whatever it is handed is one
      // refactor away from being the hole it replaced.
      const picked = typeof answer?.sourceId === "string" ? sources.find((s) => s.id === answer.sourceId) : undefined;
      finish(picked ? { sourceId: picked.id, withAudio: opts.audio && answer?.withAudio === true } : null);
    };
    const onCancel = (event: Electron.IpcMainEvent) => {
      if (mine(event)) finish(null);
    };

    ipcMain.on(CHANNEL.ready, onReady);
    ipcMain.on(CHANNEL.choose, onChoose);
    ipcMain.on(CHANNEL.cancel, onCancel);
    win.on("closed", () => finish(null));

    // A request nobody answers must not hold the page's promise open for ever.
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 120_000);

    // Nothing in this window may navigate or open anything. It is one local
    // page with one job.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());

    void win.loadFile(path.join(__dirname, "picker.html")).catch(() => finish(null));
  });
}

/** True while the picker is up, so a second request can be refused rather than stacked. */
export function displayPickerIsOpen(): boolean {
  return open !== null;
}
