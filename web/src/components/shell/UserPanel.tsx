import { Download, Headphones, HeadphoneOff, LogOut, Mic, MicOff, Pencil, Settings } from "lucide-react";
import { desktopBridge } from "@/lib/desktopBridge";
import { useDesktop } from "@/stores/desktop";
import { useEffect, useRef, useState } from "react";
import { Avatar, StatusDot, statusLabel } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { gateway } from "@/gateway/session";
import { useAuth } from "@/stores/auth";
import { activitiesOf, customStatus, statusOf, usePresence, type StatusKind } from "@/stores/presence";
import { StatusLine } from "@/components/activity/StatusLine";
import { useUI } from "@/stores/ui";
import { useVoice } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import s from "./UserPanel.module.css";
import { micMenuItems } from "@/components/voice/deviceMenus";

import { t } from "@/i18n";
function statusOptions(): { value: "online" | "idle" | "dnd" | "invisible"; label: string; sub?: string }[] {
  return [
  { value: "online", label: t("shell.user.online") },
  { value: "idle", label: t("shell.user.idle") },
  { value: "dnd", label: t("shell.user.doNotDisturb"), sub: t("shell.user.youWillNotReceiveAnyDesktop") },
  { value: "invisible", label: t("shell.user.invisible"), sub: t("shell.user.youWillAppearOfflineButKeep") },
];
}

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
  // in a call, the ring the call draws round whoever talks goes round your own picture here too
  const speaking = useVoice((v) => !!me && !!v.mine && !!v.speaking[me.id]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Opening never moved focus in and Escape never gave it back, so the menu
    // could be opened from the keyboard and then never reached.
    pop.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);
  const pop = useRef<HTMLDivElement>(null);

  // Up and down through the choices, as a menu moves.
  const onPopKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? -99 : e.key === "End" ? 99 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...(pop.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))]?.focus();
  };

  if (!me) return null;
  const status: StatusKind = statusOf(presence);
  const custom = customStatus(presence);
  const activities = activitiesOf(presence);
  const activity = activities[0];
  const choose = (value: "online" | "idle" | "dnd" | "invisible") => {
    gateway()?.sendPresence({ status: value });
    setPresence({ user_id: me.id, status: value, status_text: presence?.status_text ?? "", status_emoji: presence?.status_emoji ?? "", status_expires_at: presence?.status_expires_at ?? null });
    setOpen(false);
  };

  const openMicMenu = (at: { x: number; y: number }) =>
    void micMenuItems(openModal).then((items) => openContextMenu({ ...at, above: true, label: t("voice.voice.microphoneOptions"), items }));

  return (
    <div className={s.panel} ref={ref}>
      <button ref={trigger} className={s.me} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={32} status={status} className={s.avatar} data-speaking={speaking} />
        <span className={s.text}>
          <span className={s.name}>{me.display_name}</span>
          {custom || activity ? (
            <StatusLine className={s.sub} status={custom} activity={activity} more={Math.max(0, activities.length - 1)} />
          ) : (
            <span className={s.sub}>{statusLabel(status)}</span>
          )}
        </span>
      </button>
      <div className={s.btns}>
        <Tooltip text={muted ? t("settings.notifications.unmute") : t("settings.notifications.mute")}>
          <button
            className={s.icon}
            data-on={!muted}
            onClick={toggleMute}
            aria-label={muted ? t("voice.voice.unmute") : t("voice.voice.mute")}
            onContextMenu={(e) => {
              // a right click chooses the microphone, as the arrow on the call's mute button does
              e.preventDefault();
              openMicMenu({ x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              // Shift+F10 and the Menu key are how a keyboard opens a context
              // menu; without them the microphone could not be changed from
              // here at all without a mouse.
              if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              openMicMenu({ x: r.left, y: r.top });
            }}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </Tooltip>
        <Tooltip text={deafened ? t("shell.user.undeafen") : t("shell.user.deafen")}>
          <button className={s.icon} data-on={!deafened} onClick={toggleDeafen} aria-label={deafened ? t("shell.user.undeafen") : t("shell.user.deafen")}>
            {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
          </button>
        </Tooltip>
        {update?.status === "ready" ? (
          <Tooltip text={t("shell.user.restartToUpdateTo", { version: update.version ?? t("shell.user.theNewVersion") })}>
            <button className={[s.icon, s.update].join(" ")} onClick={() => void desktopBridge()?.updates.restart()} aria-label={t("settings.desktop.restartToUpdate")} data-testid="update-ready">
              <Download size={20} />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip text={t("settings.settings.userSettings")}>
          <button className={s.icon} onClick={() => openModal("settings", { page: "account" })} aria-label={t("settings.settings.userSettings")} data-testid="user-settings">
            <Settings size={20} />
          </button>
        </Tooltip>
      </div>
      {open ? (
        <div className={s.pop} ref={pop} role="menu" aria-label={me.display_name} onKeyDown={onPopKey}>
          {/* Not a menu item: it is who the menu is about. */}
          <div className={s.popHead} role="presentation">
            <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={40} status={status} />
            <div>
              <div className={s.popName}>{me.display_name}</div>
              <div className={s.popUser}>@{me.username}</div>
            </div>
          </div>
          <div className={s.sep} role="separator" />
          <button className={s.opt} role="menuitem" onClick={() => { setOpen(false); openModal("customStatus"); }}>
            <Pencil size={16} />
            <span className={s.optText}><span>{custom ? t("shell.user.editCustomStatus") : t("modals.customStatus.setACustomStatus")}</span></span>
          </button>
          <div className={s.sep} role="separator" />
          {statusOptions().map((o) => (
            <button key={o.value} className={s.opt} onClick={() => choose(o.value)} role="menuitemradio" aria-checked={status === o.value}>
              <StatusDot status={o.value} size={12} />
              <span className={s.optText}>
                <span>{o.label}</span>
                {o.sub ? <span className={s.optSub}>{o.sub}</span> : null}
              </span>
            </button>
          ))}
          <div className={s.sep} role="separator" />
          <button className={[s.opt, s.danger].join(" ")} role="menuitem" onClick={() => void logout()}>
            <LogOut size={16} />
            <span>{t("settings.settings.logOut")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
