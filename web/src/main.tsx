import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installCrashReporting } from "./lib/crashReport";
import "./styles/base.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // A page holds its own copy of the app until it reloads, so a deploy would
    // otherwise sit unused until someone happened to refresh. When a new
    // worker takes over an already-controlled page, pick the new version up.
    const wasControlled = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!wasControlled || reloading) return;
      reloading = true;
      window.location.reload();
    });
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // and look for one every half hour, for the tab nobody ever closes
        setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
      })
      .catch(() => undefined);
  });
}

installCrashReporting();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");
createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
