import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { installNotifications, setNotificationNavigator } from "@/lib/notify";
import { playSound } from "@/lib/sounds";
import { installTitleBadge } from "@/lib/title";
import { useAuth } from "@/stores/auth";
import { selectDMs, useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useUI } from "@/stores/ui";
import { useVoiceLocal } from "@/stores/voiceLocal";

function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Global keyboard shortcuts plus notification/title wiring; renders nothing. */
export function Shortcuts() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    installNotifications();
    setNotificationNavigator(nav);
    const stop = installTitleBadge();
    return () => {
      setNotificationNavigator(null);
      stop();
    };
  }, [nav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUI.getState();
      if (mod && e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        useVoiceLocal.getState().toggleMute();
        playSound(useVoiceLocal.getState().muted ? "mute" : "unmute");
        return;
      }
      if (mod && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        useVoiceLocal.getState().toggleDeafen();
        playSound(useVoiceLocal.getState().deafened ? "mute" : "unmute");
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        ui.openModal("shortcuts");
        return;
      }
      if (mod && e.code === "KeyE" && !ui.modal) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ec:open-emoji"));
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const meId = useAuth.getState().me?.id;
        const dms = selectDMs(useChannels.getState().byId);
        if (dms.length === 0) return;
        const cur = loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
        const idx = dms.findIndex((c) => c.id === cur);
        const next = e.key === "ArrowDown" ? (idx + 1) % dms.length : (idx - 1 + dms.length) % dms.length;
        const target = dms[next];
        if (target && meId) nav(`/channels/@me/${target.id}`);
        return;
      }
      if (e.shiftKey && (e.key === "PageUp" || e.key === "PageDown") && !inEditable(e.target)) {
        window.dispatchEvent(new CustomEvent("ec:scroll", { detail: e.key === "PageUp" ? -1 : 1 }));
        return;
      }
      if (e.key === "Escape" && !ui.modal && !ui.contextMenu && !ui.quickSwitcher && !inEditable(e.target)) {
        const ch = ui.activeChannelId;
        if (!ch) return;
        const st = useMessages.getState().channels[ch];
        const newest = st?.ids[st.ids.length - 1];
        if (newest) void useReadStates.getState().ack(ch, newest);
        if (ui.replyTo) ui.setReplyTo(null);
        if (ui.editing) ui.setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, loc.pathname]);
  return null;
}
