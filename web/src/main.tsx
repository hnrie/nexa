import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installCrashReporting } from "./lib/crashReport";
import { loadCaptchaConfig } from "./lib/captcha";
import { installLongPress } from "./lib/longPress";
import { installKeyboardInset } from "./lib/keyboardInset";
import { applyRememberedAppearance } from "./lib/theme";
import { initSafeMode } from "./lib/look/safeMode";
import { applyRememberedSheets } from "./lib/look/styles";
import { ensureTwemojiIndex } from "./lib/twemoji";
import "./styles/base.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // A page holds its own copy of the app until it reloads, so a deploy would
    // otherwise sit unused until someone happened to refresh. A new worker
    // taking over an already-controlled page means a deploy, most likely:
    // the page makes sure, and offers the new version (lib/appUpdate.ts).
    const wasControlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (wasControlled) void import("./lib/appUpdate").then((m) => m.noteNewWorker()).catch(() => undefined);
    });
    // the one that streams large downloads covers only its own addresses, so none of the app's requests pass through it
    const workers = [navigator.serviceWorker.register("/sw.js"), navigator.serviceWorker.register("/download-sw.js", { scope: "/__download/" })];
    for (const registering of workers) {
      void registering
        .then((reg) => {
          // and look for new ones every half hour, for the tab nobody ever closes
          setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
        })
        .catch(() => undefined);
    }
  });
}

installCrashReporting();
installLongPress();
// whether the actions bots abuse need a captcha here, known before anyone signs in
void loadCaptchaConfig();
installKeyboardInset();
// the first emoji on screen should not have to wait for the list of pictures
ensureTwemojiIndex();

// The look this device last had, on before anything is drawn: the account's
// own settings only arrive with the gateway's ready (see ThemeEffect). Safe
// mode is decided first, since it keeps the person's own CSS off.
initSafeMode();
applyRememberedAppearance();
applyRememberedSheets();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");
createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
