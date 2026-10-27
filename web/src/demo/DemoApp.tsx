import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { AppRoutes } from "@/routes";
import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { LookEffect } from "@/components/shell/LookEffect";
import { ThemeEffect } from "@/components/shell/ThemeEffect";
import { I18nProvider, t } from "@/i18n";
import { useAppLocale } from "@/lib/appLocale";
import { installKeyboardInset } from "@/lib/keyboardInset";
import { installLongPress } from "@/lib/longPress";
import { ensureTwemojiIndex } from "@/lib/twemoji";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { installDemoRuntime } from "./runtime";
import "@/styles/base.css";

function Demo() {
  const [account, setAccount] = useState(false);
  const locale = useAppLocale();
  const navigate = useNavigate();
  useEffect(() => {
    const ask = () => setAccount(true);
    const command = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      if (event.data?.type !== "nexa-demo-command") return;
      if (event.data.action === "server") useUI.getState().openModal("createServer");
      if (event.data.action === "notes") navigate("/channels/@me/notes");
      if (event.data.action === "appearance") useUI.getState().openModal("settings", { page: "appearance" });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-modal-layer]")) window.parent.postMessage({ type: "nexa-demo-collapse" }, location.origin);
    };
    window.addEventListener("nexa-demo-account", ask);
    window.addEventListener("message", command);
    window.addEventListener("keydown", escape);
    window.parent.postMessage({ type: "nexa-demo-ready" }, location.origin);
    return () => { window.removeEventListener("nexa-demo-account", ask); window.removeEventListener("message", command); window.removeEventListener("keydown", escape); };
  }, [navigate]);
  return <I18nProvider locale={locale}>
    <ThemeEffect />
    <LookEffect />
    <AppRoutes />
    <ContextMenuHost />
    <Toasts />
    <Modal open={account} onClose={() => setAccount(false)} title={t("home.demo.accountTitle")} centered footer={<>
      <Button variant="secondary" onClick={() => setAccount(false)}>{t("home.demo.keepExploring")}</Button>
      <Button onClick={() => window.parent.postMessage({ type: "nexa-demo-register" }, location.origin)}>{t("home.nav.getStarted")}</Button>
    </>}><p>{t("home.demo.accountBody")}</p></Modal>
  </I18nProvider>;
}

export function startDemo() {
  installDemoRuntime();
  const locale = new URLSearchParams(location.search).get("locale");
  if (locale) useSettings.getState().patch({ locale });
  installLongPress();
  installKeyboardInset();
  ensureTwemojiIndex();
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><MemoryRouter initialEntries={["/channels/@me"]}><Demo /></MemoryRouter></ErrorBoundary>);
}
