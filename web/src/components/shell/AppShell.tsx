import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Rail } from "@/components/rail/Rail";
import { DMSidebar } from "@/components/sidebar/DMSidebar";
import { ServerSidebar } from "@/components/sidebar/ServerSidebar";
import { ModalHost } from "@/components/modals/ModalHost";
import { NexaNotices } from "@/components/nexa/NexaNotices";
import { TermsGate } from "@/components/legal/TermsGate";
import { DownloadBanner } from "@/components/shell/DownloadBanner";
import { RpcBanner } from "@/components/shell/RpcBanner";
import { UpdateBanner } from "@/components/shell/UpdateBanner";
import { DesktopEffects } from "@/components/desktop/DesktopEffects";
import { Shortcuts } from "@/components/shell/Shortcuts";
import { PaneGrid } from "@/components/shell/PaneGrid";
import { PaneView } from "@/components/shell/PaneView";
import { TAB_PANEL_ID, Tabs } from "@/components/shell/Tabs";
import { useIsMobile } from "@/hooks/useIsMobile";
import { activeTab, paneAddress, panesIn, usePanes } from "@/stores/panes";
import { useChannels } from "@/stores/channels";
import { GridChatCtx } from "./paneScope";
import { useUI } from "@/stores/ui";
import { installVoice } from "@/voice/session";
import { installAway } from "@/lib/away";
import { installBackLayers } from "./backLayers";
import s from "./AppShell.module.css";
import { t } from "@/i18n";

/** Controls a horizontal drag already means something to. */
const NATIVE_DRAG = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=slider], [data-native-press]";

/** Three-pane desktop layout; on phones the rail+sidebar live in a left drawer. */
export function AppShell({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  const leftOpen = useUI((u) => u.leftOpen);
  const rightOpen = useUI((u) => u.rightOpen);
  const setLeftOpen = useUI((u) => u.setLeftOpen);
  const setRightOpen = useUI((u) => u.setRightOpen);
  const connection = useUI((u) => u.connection);
  const loc = useLocation();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const openModal = useUI((u) => u.openModal);
  const touch = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  /** Which settings page the query has already opened, so one run does it once. */
  const openedSettings = useRef<string | null>(null);
  const serverId = loc.pathname.match(/^\/channels\/(\d+)/)?.[1];
  const sidebar = serverId ? <ServerSidebar serverId={serverId} /> : <DMSidebar />;
  const tab = usePanes(activeTab);
  const panes = panesIn(tab.root);
  const setPaneChannel = usePanes((p) => p.setPaneChannel);
  // the strip is only drawn once there is more than one tab or pane (see Tabs)
  const tabCount = usePanes((p) => p.tabs.length);
  const tabbed = tabCount > 1 || panes.length > 1;
  // In a split, a conversation in the focused pane is drawn by the grid like
  // every other pane (see GridChatCtx), so focus can move without a remount.
  // Only a conversation: a voice room, Friends, the Nexa page and the admin
  // panel are still the routed page's to draw.
  const routedChannelId = loc.pathname.match(/^\/channels\/(?:@me|\d+)\/(\d+)$/)?.[1];
  const routedChannel = useChannels((c) => (routedChannelId ? c.byId[routedChannelId] : undefined));
  const gridChat = !mobile && panes.length > 1 && !!routedChannel && routedChannel.type !== "voice" && routedChannel.type !== "category";

  // The address bar and the focused pane are kept as one thing, and only one
  // of them is ever in charge at a time.
  //
  // Normally it is the address: a click in the sidebar, a link in a message,
  // the back button and a notification all navigate exactly as they always
  // did, and the focused pane follows. The one exception is focus itself
  // moving — to another pane, or to another tab, or because the pane you were
  // in was closed — where the pane is in charge and the address follows it.
  // That navigation comes straight back here with focus unchanged, and the
  // first branch turns it into a no-op.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const moved = lastFocus.current !== null && lastFocus.current !== tab.focus;
    lastFocus.current = tab.focus;
    if (moved) {
      nav(paneAddress(usePanes.getState().panes[tab.focus]));
      return;
    }
    const at = loc.pathname.match(/^\/channels\/(@me|\d+)(?:\/(\d+))?/);
    setPaneChannel(tab.focus, at?.[1] === "@me" ? null : (at?.[1] ?? null), at?.[2] ?? null);
  }, [loc.pathname, tab.focus, setPaneChannel, nav]);

  useEffect(() => {
    const page = params.get("settings");
    if (!page) {
      openedSettings.current = null;
      return;
    }
    // Opening was kept to once only by the effect mutating the shared params
    // object out from under its own next run. The guard says it plainly, and
    // the copy below leaves the router's object alone.
    if (openedSettings.current === page) return;
    openedSettings.current = page;
    openModal("settings", { page });
    const next = new URLSearchParams(params);
    next.delete("settings");
    setParams(next, { replace: true });
  }, [params, setParams, openModal]);

  useEffect(() => {
    installVoice();
    installAway();
  }, []);

  // back closes the dialog, the settings or the drawer on top (see backLayers)
  useEffect(() => installBackLayers(), []);

  // Going somewhere closes the drawers. Picking a server or Direct Messages in
  // the rail only changes which list the drawer shows, so the drawer stays open
  // for the user to choose a channel or conversation in it.
  const keepDrawer = (loc.state as { keepDrawer?: boolean } | null)?.keepDrawer === true;
  useEffect(() => {
    if (!keepDrawer) setLeftOpen(false);
    setRightOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, setLeftOpen, setRightOpen]);

  useEffect(() => {
    if (!mobile) return;
    // put back what was there rather than clearing outright: the drawer is not
    // the only thing that can want the page behind it to stop scrolling
    const before = document.body.style.overflow;
    document.body.style.overflow = leftOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = before;
    };
  }, [leftOpen, mobile]);

  // --- swiping the drawers -------------------------------------------------
  // The drawer follows the finger and snaps when it is let go, so it feels
  // like a drawer rather than a shortcut that either fires or does not.
  // `right` is a swipe that started with the member list open; it can only push that list away.
  const drag = useRef<{ x: number; y: number; t: number; axis: "" | "x" | "y"; from: boolean; right: boolean } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  const drawerWidth = () => Math.min(420, Math.max(240, window.innerWidth - 56));
  // Which way "towards opening" is: in a right-to-left language the drawer
  // lives on the right edge and opens with a swipe to the left. Everything
  // below measures along that direction.
  const flow = () => (document.documentElement.dir === "rtl" ? -1 : 1);

  /** A swipe inside something that scrolls sideways belongs to that thing. */
  const scrollsSideways = (target: EventTarget | null): boolean => {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.body) {
      if (el.hasAttribute("data-no-swipe")) return true;
      if (el.scrollWidth > el.clientWidth + 4) {
        const overflow = getComputedStyle(el).overflowX;
        if (overflow === "auto" || overflow === "scroll") return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!mobile || !t) return;
    if (document.querySelector("[data-modal-layer]")) return;
    // a drag on a slider or in a text field moves the slider or the caret, not the drawer
    if (e.target instanceof Element && e.target.closest(NATIVE_DRAG)) return;
    if (scrollsSideways(e.target)) return;
    drag.current = { x: t.clientX, y: t.clientY, t: Date.now(), axis: "", from: leftOpen, right: rightOpen && !leftOpen };
  };

  const onTouchMove = (e: TouchEvent) => {
    const d = drag.current;
    const t = e.touches[0];
    if (!d || !t) return;
    const dx = (t.clientX - d.x) * flow();
    const dy = t.clientY - d.y;
    if (d.axis === "") {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (d.axis === "y") drag.current = null;
      return;
    }
    if (d.right) return;
    const w = drawerWidth();
    const at = d.from ? w + dx : dx;
    setDragX(Math.max(0, Math.min(w, at)));
  };

  const onTouchEnd = (e: TouchEvent) => {
    const d = drag.current;
    const t = e.changedTouches[0];
    drag.current = null;
    if (!d || !t || d.axis !== "x") {
      setDragX(null);
      return;
    }
    const dx = (t.clientX - d.x) * flow();
    const w = drawerWidth();
    const speed = dx / Math.max(1, Date.now() - d.t);
    if (d.right) {
      setDragX(null);
      if (dx > 60 || speed > 0.4) setRightOpen(false);
      return;
    }
    const open = Math.abs(speed) > 0.4 ? dx > 0 : (d.from ? w + dx : dx) > w * 0.4;
    setDragX(null);
    if (open) setLeftOpen(true);
    else if (d.from) setLeftOpen(false);
    else if (dx < -60) setRightOpen(true); // a left swipe with nothing open looks right
  };

  const dragging = dragX !== null;
  const drawerStyle = dragging ? { transform: `translateX(${(dragX - drawerWidth()) * flow()}px)`, transition: "none" } : undefined;
  const backdropStyle = dragging ? { opacity: dragX / drawerWidth(), pointerEvents: "none" as const, transition: "none" } : undefined;

  return (
    <div className={s.app} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      {mobile ? (
        <>
          <div className={s.backdrop} data-open={leftOpen || dragging} style={backdropStyle} onClick={() => setLeftOpen(false)} />
          <div className={s.drawer} data-open={leftOpen} style={drawerStyle}>
            <div className={s.rail}><Rail /></div>
            <div className={s.sidebar}>{sidebar}</div>
          </div>
        </>
      ) : (
        <>
          <div className={s.rail}><Rail /></div>
          <div className={s.sidebar}>{sidebar}</div>
        </>
      )}
      <div className={s.main}>
        {connection !== "open" && connection !== "idle" ? (
          <div className={s.connection} data-state={connection} role="status">{connection === "connecting" ? t("shell.requireAuth.connecting") : t("shell.appShell.disconnectedReconnecting")}</div>
        ) : null}
        <UpdateBanner />
        <RpcBanner />
        <DownloadBanner />
        <Tabs />
        {/* the page takes what the banner leaves */}
        <div className={s.page} {...(tabbed ? { role: "tabpanel", id: TAB_PANEL_ID, "aria-labelledby": `tab-${tab.id}` } : {})}>
          {/* The grid is here even for a single pane, so that pane is measured
              and the menu knows whether there is room to split it. `split` is
              what turns on the chrome — the close button and the focus ring —
              which a lone pane has no use for. On a phone there is only ever
              the page itself. */}
          {mobile ? (
            children
          ) : (
            <PaneGrid
              tile={tab.root}
              focus={tab.focus}
              split={panes.length > 1}
              renderPane={(paneId) => (paneId === tab.focus && !gridChat ? children : <PaneView key={paneId} paneId={paneId} />)}
            />
          )}
          {/* the routed page still runs, for what it does besides drawing */}
          {!mobile && gridChat ? (
            <div hidden>
              <GridChatCtx.Provider value={true}>{children}</GridChatCtx.Provider>
            </div>
          ) : null}
        </div>
      </div>
      <ModalHost />
      <NexaNotices />
      <TermsGate />
      <Shortcuts />
      <DesktopEffects />
    </div>
  );
}
