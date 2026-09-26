import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { installNotifications, setNotificationNavigator } from "@/lib/notify";
import { playSound } from "@/lib/sounds";
import { installTitleBadge } from "@/lib/title";
import { useAuth } from "@/stores/auth";
import { channelTree, selectDMs, useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useTabs } from "@/stores/tabs";
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
        // once is enough: pressed again, the list used to stack a second copy on the first
        if (!ui.modals.some((m) => m.kind === "shortcuts")) ui.openModal("shortcuts");
        return;
      }
      if (mod && e.code === "KeyE" && !ui.modal) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ec:open-emoji"));
        return;
      }
      // Tabs. Not Ctrl+Tab or Ctrl+W: a browser keeps both for its own tabs and
      // will not let a page have them, so these are the ones a browser leaves
      // alone — and they still work in the desktop app, where nothing else
      // wants them either.
      if (mod && e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const tabs = useTabs.getState();
        if (tabs.tabs.length < 2) return;
        e.preventDefault();
        const at = tabs.tabs.findIndex((t) => t.id === tabs.active);
        const step = e.key === "ArrowRight" ? 1 : -1;
        tabs.selectTab(tabs.tabs[(at + step + tabs.tabs.length) % tabs.tabs.length]!.id);
        return;
      }
      if (mod && e.altKey && e.code === "KeyW") {
        const tabs = useTabs.getState();
        e.preventDefault();
        // the last tab stays: closing it would leave nothing
        if (tabs.tabs.length > 1) tabs.closeTab(tabs.active);
        return;
      }
      // Alt+↑/↓ steps through the list beside the page: the server's channels
      // in a server, the conversations otherwise. From the message box too,
      // but not from other fields (Option+arrows move the caret there on a
      // Mac) and not from behind a dialog.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const target = e.target as HTMLElement | null;
        if ((inEditable(target) && !target?.hasAttribute("data-composer")) || document.querySelector("[data-modal-layer]")) return;
        e.preventDefault();
        if (!useAuth.getState().me) return;
        const byId = useChannels.getState().byId;
        const inServer = loc.pathname.match(/^\/channels\/(\d+)\/(\d+)/);
        const list = inServer
          ? (() => {
              const tree = channelTree(byId, inServer[1]!);
              return [...tree.loose, ...tree.categories.flatMap((c) => c.children)].filter((c) => c.type === "text" || c.type === "voice");
            })()
          : selectDMs(byId);
        if (list.length === 0) return;
        const cur = inServer ? inServer[2] : loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
        const idx = list.findIndex((c) => c.id === cur);
        const next = e.key === "ArrowDown" ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
        const to = list[next];
        if (to) nav(inServer ? `/channels/${inServer[1]}/${to.id}` : `/channels/@me/${to.id}`);
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
        // A list jumped back into history ends at an old message. Acking that
        // moves the read mark backwards on the server and clears mentions
        // nobody has read.
        if (newest && st && !st.hasNewer) void useReadStates.getState().ack(ch, newest);
        if (ui.replyTo) ui.setReplyTo(null);
        if (ui.editing) ui.setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, loc.pathname]);
  return null;
}
