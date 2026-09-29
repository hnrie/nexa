import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import d from "@/components/desktop/Desktop.module.css";
import { desktopBridge, type DesktopSettings, type UpdateState } from "@/lib/desktopBridge";
import { formatRelative } from "@/lib/time";
import { useDesktop } from "@/stores/desktop";
import st from "./Settings.module.css";

import { t as tr_ } from "@/i18n";
/** User settings → Desktop App: how the app starts, and updates. Only inside the app; its Rich Presence is under Activity. */
export default function DesktopPage({ onActivity }: { onActivity?: () => void }) {
  const bridge = desktopBridge();
  const update = useDesktop((x) => x.update);
  const [app, setApp] = useState<DesktopSettings | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.settings.get().then(setApp);
  }, [bridge]);

  if (!bridge) return null;
  const setApp_ = (p: Partial<DesktopSettings>) => void bridge.settings.set(p).then(setApp);

  return (
    <>
      <h2 className={st.title}>{tr_("settings.desktop.desktopApp")}</h2>
      <div className={st.form}>
        <h3 className={st.h5}>{tr_("settings.desktop.richPresence")}</h3>
        <div className={d.status} data-tone="muted">
          <Info size={18} />
          <div className={d.statusText}>
            <span>{tr_("settings.desktop.richPresenceMoved")}</span>
            {onActivity ? (
              <div>
                <Button size="sm" variant="secondary" onClick={onActivity} data-testid="open-activity">{tr_("settings.activity.title")}</Button>
              </div>
            ) : null}
          </div>
        </div>

        <h3 className={st.h5}>{tr_("settings.desktop.startupAndWindow")}</h3>
        {app ? (
          <>
            <Toggle checked={app.launchAtLogin} onChange={(v) => setApp_({ launchAtLogin: v })} label={tr_("settings.desktop.openNexaWhenISignIn")} description={tr_("settings.desktop.startingBeforeDiscordLetsProgramsReach")} />
            <Toggle checked={app.startMinimized} onChange={(v) => setApp_({ startMinimized: v })} disabled={!app.launchAtLogin} label={tr_("settings.desktop.startInTheBackground")} description={tr_("settings.desktop.whenOpenedAtSignInStay")} />
            <Toggle checked={app.closeToTray} onChange={(v) => setApp_({ closeToTray: v })} label={tr_("settings.desktop.keepRunningWhenTheWindowIs")} description={tr_("settings.desktop.callsNotificationsAndRichPresenceCarry")} />
            <Toggle checked={app.hardwareAcceleration} onChange={(v) => setApp_({ hardwareAcceleration: v })} label={tr_("settings.desktop.hardwareAcceleration")} description={tr_("settings.desktop.usesTheGraphicsCardForSmoother")} />
          </>
        ) : null}

        <h3 className={st.h5}>{tr_("settings.desktop.updates")}</h3>
        <UpdateRow version={bridge.version} update={update} />
      </div>
    </>
  );
}

function UpdateRow({ version, update: u }: { version: string; update: UpdateState | null }) {
  const line =
    u?.status === "checking" ? tr_("settings.desktop.checkingForUpdates")
      : u?.status === "downloading" ? tr_("settings.desktop.downloadingVersion", { version: u.version ?? "" })
        : u?.status === "ready" ? tr_("settings.desktop.versionIsReadyToInstall", { version: u.version })
          : u?.status === "manual" ? tr_("settings.desktop.versionIsOut", { version: u.version })
            : u?.status === "error" ? tr_("settings.desktop.couldNotCheckForUpdates", { error: u.error ?? tr_("settings.desktop.unknownError") })
              : tr_("settings.desktop.youReUpToDate");
  return (
    <div>
      <div className={d.version}>
        <div className={d.versionText}>
          Nexa {version}
          <small>{line}{u?.lastCheck ? tr_("settings.desktop.lastChecked", { when: formatRelative(u.lastCheck) }) : ""}</small>
        </div>
        {u?.status === "ready" ? (
          <Button onClick={() => void desktopBridge()?.updates.restart()} data-testid="update-restart">{tr_("settings.desktop.restartToUpdate")}</Button>
        ) : u?.status === "manual" && u.downloadUrl ? (
          <Button onClick={() => window.open(u.downloadUrl, "_blank")}>{tr_("chat.attachments.download")}</Button>
        ) : (
          <Button variant="secondary" loading={u?.status === "checking"} disabled={u?.status === "downloading"} onClick={() => void desktopBridge()?.updates.check()} data-testid="update-check">{tr_("settings.desktop.checkForUpdates")}</Button>
        )}
      </div>
      {u?.status === "downloading" ? <div className={d.progress}><i style={{ width: `${Math.round((u.progress ?? 0) * 100)}%` }} /></div> : null}
    </div>
  );
}
