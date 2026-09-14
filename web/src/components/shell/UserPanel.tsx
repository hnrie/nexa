import { Download, Headphones, HeadphoneOff, LogOut, Mic, MicOff, Pencil, Settings } from "lucide-react";
import { desktopBridge } from "@/lib/desktopBridge";
import { useDesktop } from "@/stores/desktop";
import { useEffect, useRef, useState } from "react";
import { Avatar, StatusDot, statusLabel } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { gateway } from "@/gateway/session";
import { useAuth } from "@/stores/auth";
import { customStatus, statusOf, usePresence, type StatusKind } from "@/stores/presence";
import { useUI } from "@/stores/ui";
import { useVoiceLocal } from "@/stores/voiceLocal";
import s from "./UserPanel.module.css";
import { micMenuItems } from "@/components/voice/deviceMenus";

const OPTIONS: { value: "online" | "idle" | "dnd" | "invisible"; label: string; sub?: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do Not Disturb", sub: "You will not receive any desktop notifications." },
  { value: "invisible", label: "Invisible", sub: "You will appear offline but keep full access." },
];

export function UserPanel() {
  const me = useAuth((a) => a.me);
  const logout = useAuth((a) => a.logout);
  const presence = usePresence((p) => (me ? p.byUser[me.id] : undefined));
  const setPresence = usePresence((p) => p.set);
  const openModal = useUI((u) => u.openModal);
  const update = useDesktop((x) => x.update);
  const muted = useVoiceLocal((v) => v.muted);
  const deafened = useVoiceLocal((v) => v.deafened);
  const toggleMute = useVoiceLocal((v) => v.toggleMute);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const toggleDeafen = useVoiceLocal((v) => v.toggleDeafen);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me) return null;
  const status: StatusKind = statusOf(presence);
  const custom = customStatus(presence);
  const choose = (value: "online" | "idle" | "dnd" | "invisible") => {
    gateway()?.sendPresence({ status: value });
    setPresence({ user_id: me.id, status: value, status_text: presence?.status_text ?? "", status_emoji: presence?.status_emoji ?? "", status_expires_at: presence?.status_expires_at ?? null });
    setOpen(false);
  };

  return (
    <div className={s.panel} ref={ref}>
      <button className={s.me} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={32} status={status} />
        <span className={s.text}>
          <span className={s.name}>{me.display_name}</span>
          <span className={s.sub}>{custom ? `${custom.emoji ? custom.emoji + " " : ""}${custom.text}` : statusLabel(status)}</span>
        </span>
      </button>
      <div className={s.btns}>
        <Tooltip text={muted ? "Unmute" : "Mute"}>
          <button
            className={s.icon}
            data-on={!muted}
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            onContextMenu={(e) => {
              // a right click chooses the microphone, as the arrow on the call's mute button does
              e.preventDefault();
              const at = { x: e.clientX, y: e.clientY };
              void micMenuItems(openModal).then((items) => openContextMenu({ ...at, above: true, items }));
            }}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </Tooltip>
        <Tooltip text={deafened ? "Undeafen" : "Deafen"}>
          <button className={s.icon} data-on={!deafened} onClick={toggleDeafen} aria-label={deafened ? "Undeafen" : "Deafen"}>
            {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
          </button>
        </Tooltip>
        {update?.status === "ready" ? (
          <Tooltip text={`Restart to update to ${update.version ?? "the new version"}`}>
            <button className={[s.icon, s.update].join(" ")} onClick={() => void desktopBridge()?.updates.restart()} aria-label="Restart to update" data-testid="update-ready">
              <Download size={20} />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip text="User Settings">
          <button className={s.icon} onClick={() => openModal("settings", { page: "account" })} aria-label="User Settings">
            <Settings size={20} />
          </button>
        </Tooltip>
      </div>
      {open ? (
        <div className={s.pop} role="menu">
          <div className={s.popHead}>
            <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={40} status={status} />
            <div>
              <div className={s.popName}>{me.display_name}</div>
              <div className={s.popUser}>@{me.username}</div>
            </div>
          </div>
          <div className={s.sep} />
          <button className={s.opt} onClick={() => { setOpen(false); openModal("customStatus"); }}>
            <Pencil size={16} />
            <span className={s.optText}><span>{custom ? "Edit custom status" : "Set a custom status"}</span></span>
          </button>
          <div className={s.sep} />
          {OPTIONS.map((o) => (
            <button key={o.value} className={s.opt} onClick={() => choose(o.value)} role="menuitemradio" aria-checked={status === o.value}>
              <StatusDot status={o.value} size={12} />
              <span className={s.optText}>
                <span>{o.label}</span>
                {o.sub ? <span className={s.optSub}>{o.sub}</span> : null}
              </span>
            </button>
          ))}
          <div className={s.sep} />
          <button className={[s.opt, s.danger].join(" ")} onClick={() => void logout()}>
            <LogOut size={16} />
            <span>Log Out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
