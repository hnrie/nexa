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
    ? { tone: "muted", icon: <Info size={18} />, text: "Rich Presence is off. Programs talk only to Discord, if it is running." }
    : !rpc.relay
      ? { tone: "muted", icon: <Info size={18} />, text: "Activity shows here only; Discord does not get it from nexa." }
      : discord === "connected"
        ? { tone: "good", icon: <CheckCircle2 size={18} />, text: "Discord is running: activity shows here and on Discord." }
        : discord === "first"
          ? { tone: "warn", icon: <TriangleAlert size={18} />, text: "Discord started before nexa, so programs talk only to Discord. Restart Discord and they will reach both." }
          : { tone: "good", icon: <CheckCircle2 size={18} />, text: "Discord isn't running: activity shows here, and will reach Discord too once it opens." };

  const restartDiscord = async () => {
    setRestarting(true);
    try {
      if (!(await bridge.rpc.restartDiscord())) toast("Discord doesn't seem to be running.", "info");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <h2 className={st.title}>Desktop App</h2>
      <div className={st.form}>
        <h5 className={st.h5}>Rich Presence</h5>
        <Toggle
          checked={!!rpc?.enabled}
          onChange={(on) => void bridge.rpc.setEnabled(on)}
          label="Show what I'm playing, watching and listening to"
          description="Games, music players and other programs that show Rich Presence on Discord tell nexa too, with or without Discord running."
        />
        <Toggle
          checked={share !== false}
          onChange={(on) => patch({ shareActivity: on })}
          disabled={!rpc?.enabled}
          label="Share my activity with others"
          description="People who can see your status see it on your profile. Off keeps it to this app."
        />
        <Toggle checked={!!rpc?.relay} onChange={(on) => void bridge.rpc.setRelay(on)} disabled={!rpc?.enabled} label="Also show it on Discord" description="When Discord is running, programs reach it through nexa, so your activity shows there as well." />
        <div className={d.status} data-tone={status.tone} data-testid="rpc-status">
          {status.icon}
          <div className={d.statusText}>
            <span>{status.text}</span>
            {discord === "first" && rpc?.enabled && bridge.platform === "win32" ? (
              <div>
                <Button size="sm" variant="secondary" loading={restarting} onClick={() => void restartDiscord()}>Restart Discord</Button>
              </div>
            ) : null}
          </div>
        </div>

        <h5 className={st.h5}>Programs</h5>
        {!rpc || rpc.apps.length === 0 ? (
          <p className={st.hint}>Nothing is using Rich Presence right now. Open a game or music player that shows your activity on Discord.</p>
        ) : (
          <div className={d.apps}>
            {rpc.apps.map((a) => (
              <ProgramRow key={`${a.clientId}:${a.connectedAt}`} app={a} preview={previews[a.clientId]} onHide={(hidden) => void bridge.rpc.setHidden(a.clientId, hidden)} />
            ))}
          </div>
        )}

        <h5 className={st.h5}>Startup and window</h5>
        {app ? (
          <>
            <Toggle checked={app.launchAtLogin} onChange={(v) => setApp_({ launchAtLogin: v })} label="Open nexa when I sign in" description="Starting before Discord lets programs reach both of them." />
            <Toggle checked={app.startMinimized} onChange={(v) => setApp_({ startMinimized: v })} disabled={!app.launchAtLogin} label="Start in the background" description="When opened at sign-in, stay in the tray until you open it." />
            <Toggle checked={app.closeToTray} onChange={(v) => setApp_({ closeToTray: v })} label="Keep running when the window is closed" description="Calls, notifications and Rich Presence carry on from the tray." />
            <Toggle checked={app.hardwareAcceleration} onChange={(v) => setApp_({ hardwareAcceleration: v })} label="Hardware acceleration" description="Uses the graphics card for smoother video. Turn off if the window flickers; applies after restarting the app." />
          </>
        ) : null}

        <h5 className={st.h5}>Updates</h5>
        <UpdateRow version={bridge.version} update={update} />
      </div>
    </>
  );
}

function UpdateRow({ version, update: u }: { version: string; update: UpdateState | null }) {
  const line =
    u?.status === "checking" ? "Checking for updates…"
      : u?.status === "downloading" ? `Downloading version ${u.version ?? ""}…`
        : u?.status === "ready" ? `Version ${u.version} is ready to install.`
          : u?.status === "manual" ? `Version ${u.version} is out.`
            : u?.status === "error" ? `Could not check for updates: ${u.error ?? "unknown error"}`
              : "You're up to date.";
  return (
    <div>
      <div className={d.version}>
        <div className={d.versionText}>
          nexa {version}
          <small>{line}{u?.lastCheck ? ` Last checked ${formatRelative(u.lastCheck)}.` : ""}</small>
        </div>
        {u?.status === "ready" ? (
          <Button onClick={() => void desktopBridge()?.updates.restart()} data-testid="update-restart">Restart to update</Button>
        ) : u?.status === "manual" && u.downloadUrl ? (
          <Button onClick={() => window.open(u.downloadUrl, "_blank")}>Download</Button>
        ) : (
          <Button variant="secondary" loading={u?.status === "checking"} disabled={u?.status === "downloading"} onClick={() => void desktopBridge()?.updates.check()} data-testid="update-check">Check for updates</Button>
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
          <div className={d.appSub}>Connected {formatRelative(app.connectedAt)}</div>
        </div>
        <Toggle checked={!app.hidden} onChange={(on) => onHide(!on)} ariaLabel={`Show ${name} on my profile`} />
      </div>
      {app.activity && preview ? (
        <div className={d.preview}><ActivityCard activity={preview} /></div>
      ) : (
        <div className={d.appIdle}>{app.activity ? "Loading preview…" : "Connected, not showing anything right now."}</div>
      )}
    </div>
  );
}
