import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { activities as activitiesApi } from "@/api/activities";
import type { Activity } from "@/api/types";
import { ActivityCard } from "@/components/activity/ActivityCard";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import d from "@/components/desktop/Desktop.module.css";
import { desktopBridge, type DesktopSettings, type RpcApp, type UpdateState } from "@/lib/desktopBridge";
import { formatRelative } from "@/lib/time";
import { useDesktop } from "@/stores/desktop";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import st from "./Settings.module.css";

import { t as tr_ } from "@/i18n";
/** User settings → Desktop App: Rich Presence, how the app starts, and updates. Only inside the app. */
export default function DesktopPage() {
  const bridge = desktopBridge();
  const rpc = useDesktop((x) => x.rpc);
  const update = useDesktop((x) => x.update);
  const share = useSettings((x) => x.settings.shareActivity);
  const patch = useSettings((x) => x.patch);
  const toast = useUI((u) => u.toast);
  const [app, setApp] = useState<DesktopSettings | null>(null);
  const [previews, setPreviews] = useState<Record<string, Activity>>({});
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.settings.get().then(setApp);
    void bridge.rpc.getState().then((s) => useDesktop.getState().setRpc(s));
  }, [bridge]);

  // names, icons and art as others will see them, from the server that resolves them for everyone
  const appsKey = useMemo(() => JSON.stringify(rpc?.apps.map((a) => [a.clientId, a.activity]) ?? []), [rpc]);
  useEffect(() => {
    const apps = rpc?.apps ?? [];
    if (apps.length === 0) {
      setPreviews({});
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      const wanted = apps.map((a) => a.activity ?? { application_id: a.clientId, type: 0 as const });
      activitiesApi
        .preview(wanted)
        .then((list) => {
          if (!alive) return;
          const next: Record<string, Activity> = {};
          for (const act of list) if (act.application_id) next[act.application_id] = act;
          setPreviews(next);
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // appsKey stands for rpc.apps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appsKey]);

  if (!bridge) return null;
  const setApp_ = (p: Partial<DesktopSettings>) => void bridge.settings.set(p).then(setApp);

  const discord = rpc?.discord ?? "absent";
  const status = !rpc?.enabled
    ? { tone: "muted", icon: <Info size={18} />, text: tr_("settings.desktop.richPresenceIsOffProgramsTalk") }
    : !rpc.relay
      ? { tone: "muted", icon: <Info size={18} />, text: tr_("settings.desktop.activityShowsHereOnlyDiscordDoes") }
      : discord === "connected"
        ? { tone: "good", icon: <CheckCircle2 size={18} />, text: tr_("settings.desktop.discordIsRunningActivityShowsHere") }
        : discord === "first"
          ? { tone: "warn", icon: <TriangleAlert size={18} />, text: tr_("settings.desktop.discordStartedBeforeNexaSoPrograms") }
          : { tone: "good", icon: <CheckCircle2 size={18} />, text: tr_("settings.desktop.discordIsnTRunningActivityShows") };

  const restartDiscord = async () => {
    setRestarting(true);
    try {
      if (!(await bridge.rpc.restartDiscord())) toast(tr_("settings.desktop.discordDoesnTSeemToBe"), "info");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <h2 className={st.title}>{tr_("settings.desktop.desktopApp")}</h2>
      <div className={st.form}>
        <h5 className={st.h5}>{tr_("settings.desktop.richPresence")}</h5>
        <Toggle
          checked={!!rpc?.enabled}
          onChange={(on) => void bridge.rpc.setEnabled(on)}
          label={tr_("settings.desktop.showWhatIMPlayingWatching")}
          description={tr_("settings.desktop.gamesMusicPlayersAndOtherPrograms")}
        />
        <Toggle
          checked={share !== false}
          onChange={(on) => patch({ shareActivity: on })}
          disabled={!rpc?.enabled}
          label={tr_("settings.desktop.shareMyActivityWithOthers")}
          description={tr_("settings.desktop.peopleWhoCanSeeYourStatus")}
        />
        <Toggle checked={!!rpc?.relay} onChange={(on) => void bridge.rpc.setRelay(on)} disabled={!rpc?.enabled} label={tr_("settings.desktop.alsoShowItOnDiscord")} description={tr_("settings.desktop.whenDiscordIsRunningProgramsReach")} />
        <div className={d.status} data-tone={status.tone} data-testid="rpc-status">
          {status.icon}
          <div className={d.statusText}>
            <span>{status.text}</span>
            {discord === "first" && rpc?.enabled && bridge.platform === "win32" ? (
              <div>
                <Button size="sm" variant="secondary" loading={restarting} onClick={() => void restartDiscord()}>{tr_("settings.desktop.restartDiscord")}</Button>
              </div>
            ) : null}
          </div>
        </div>

        <h5 className={st.h5}>{tr_("settings.desktop.programs")}</h5>
        {!rpc || rpc.apps.length === 0 ? (
          <p className={st.hint}>{tr_("settings.desktop.nothingIsUsingRichPresenceRight")}</p>
        ) : (
          <div className={d.apps}>
            {rpc.apps.map((a) => (
              <ProgramRow key={`${a.clientId}:${a.connectedAt}`} app={a} preview={previews[a.clientId]} onHide={(hidden) => void bridge.rpc.setHidden(a.clientId, hidden)} />
            ))}
          </div>
        )}

        <h5 className={st.h5}>{tr_("settings.desktop.startupAndWindow")}</h5>
        {app ? (
          <>
            <Toggle checked={app.launchAtLogin} onChange={(v) => setApp_({ launchAtLogin: v })} label={tr_("settings.desktop.openNexaWhenISignIn")} description={tr_("settings.desktop.startingBeforeDiscordLetsProgramsReach")} />
            <Toggle checked={app.startMinimized} onChange={(v) => setApp_({ startMinimized: v })} disabled={!app.launchAtLogin} label={tr_("settings.desktop.startInTheBackground")} description={tr_("settings.desktop.whenOpenedAtSignInStay")} />
            <Toggle checked={app.closeToTray} onChange={(v) => setApp_({ closeToTray: v })} label={tr_("settings.desktop.keepRunningWhenTheWindowIs")} description={tr_("settings.desktop.callsNotificationsAndRichPresenceCarry")} />
            <Toggle checked={app.hardwareAcceleration} onChange={(v) => setApp_({ hardwareAcceleration: v })} label={tr_("settings.desktop.hardwareAcceleration")} description={tr_("settings.desktop.usesTheGraphicsCardForSmoother")} />
          </>
        ) : null}

        <h5 className={st.h5}>{tr_("settings.desktop.updates")}</h5>
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

function ProgramRow({ app, preview, onHide }: { app: RpcApp; preview: Activity | undefined; onHide: (hidden: boolean) => void }) {
  const name = preview?.name || app.name || `Program ${app.clientId}`;
  return (
    <div className={d.app} data-hidden={app.hidden} data-testid="rpc-app">
      <div className={d.appHead}>
        <div style={{ minWidth: 0 }}>
          <div className={d.appName}>{name}</div>
          <div className={d.appSub}>{tr_("settings.desktop.connectedAt", { when: formatRelative(app.connectedAt) })}</div>
        </div>
        <Toggle checked={!app.hidden} onChange={(on) => onHide(!on)} ariaLabel={tr_("settings.desktop.showOnMyProfile", { name })} />
      </div>
      {app.activity && preview ? (
        <div className={d.preview}><ActivityCard activity={preview} /></div>
      ) : (
        <div className={d.appIdle}>{app.activity ? tr_("settings.desktop.loadingPreview") : tr_("settings.desktop.connectedNotShowingAnythingRightNow")}</div>
      )}
    </div>
  );
}
