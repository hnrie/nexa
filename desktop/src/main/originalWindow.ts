import type { BrowserWindow, WindowOpenHandlerResponse } from "electron";
import { ORIGIN } from "./config";

/** A decrypted original lives in this session, so an external browser cannot read it. */
export function originalWindow(url: string): WindowOpenHandlerResponse | null {
  try {
    const target = new URL(url);
    if (target.protocol !== "blob:" || target.origin !== ORIGIN) return null;
  } catch {
    return null;
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        javascript: false,
        webviewTag: false,
        webSecurity: true,
        preload: undefined,
        additionalArguments: [],
      },
    },
  };
}

/** No app bridge, scripts, further windows or navigation from an original. */
export function lockOriginalWindow(win: BrowserWindow, original: string): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (event, url) => { if (url !== original) event.preventDefault(); });
  wc.on("will-frame-navigate", (event) => { if (event.url !== original) event.preventDefault(); });
  wc.on("will-redirect", (event) => event.preventDefault());
}
