import { RotateCw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { desktopBridge } from "@/lib/desktopBridge";
import { useDesktop } from "@/stores/desktop";
import { useUI } from "@/stores/ui";
import s from "./DownloadBanner.module.css";

import { t } from "@/i18n";
/**
 * Discord holds the pipe that programs try first, so one that was already
 * running when Nexa started keeps every game and music player to itself.
 * Nothing here can take it over; Discord has to be started again, after this
 * app. Saying so where it happens beats leaving Rich Presence quietly broken
 * until someone opens settings. Closing it keeps it away for this session.
 */
export function RpcBanner() {
  const rpc = useDesktop((x) => x.rpc);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const bridge = desktopBridge();
  if (!bridge || closed || !rpc?.enabled || !rpc.relay || rpc.discord !== "first") return null;

  const restart = async () => {
    setBusy(true);
    try {
      if (!(await bridge.rpc.restartDiscord())) useUI.getState().toast(t("settings.desktop.discordDoesnTSeemToBe"), "info");
    } catch {
      useUI.getState().toast(t("shell.rpcBanner.discordCouldNotBeRestartedFrom"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.banner} role="region" aria-label={t("settings.desktop.richPresence")} data-testid="rpc-banner">
      <span className={s.icon}><TriangleAlert size={18} /></span>
      <span className={s.text}>
        <b>{t("shell.rpcBanner.discordWasAlreadyRunningWhenNexa")}</b>
        <span style={{ opacity: 0.8 }}> {t("shell.rpcBanner.programsAreReachingOnlyDiscordRestart")}</span>
      </span>
      <button className={s.download} onClick={() => void restart()} disabled={busy} data-testid="rpc-banner-restart">
        <RotateCw size={14} /> {busy ? t("shell.rpcBanner.restarting") : t("settings.desktop.restartDiscord")}
      </button>
      <button className={s.close} aria-label={t("chat.attachments.close")} title={t("chat.attachments.close")} onClick={() => setClosed(true)} data-testid="rpc-banner-close"><X size={16} /></button>
    </div>
  );
}
