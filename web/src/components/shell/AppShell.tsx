import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Rail } from "@/components/rail/Rail";
import { DMSidebar } from "@/components/sidebar/DMSidebar";
import { ServerSidebar } from "@/components/sidebar/ServerSidebar";
import { ModalHost } from "@/components/modals/ModalHost";
import { DownloadBanner } from "@/components/shell/DownloadBanner";
import { RpcBanner } from "@/components/shell/RpcBanner";
import { UpdateBanner } from "@/components/shell/UpdateBanner";
import { DesktopEffects } from "@/components/desktop/DesktopEffects";
import { Shortcuts } from "@/components/shell/Shortcuts";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUI } from "@/stores/ui";
import { installVoice } from "@/voice/session";
import s from "./AppShell.module.css";

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
  const [params, setParams] = useSearchParams();
  const openModal = useUI((u) => u.openModal);
  const touch = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const serverId = loc.pathname.match(/^\/channels\/(\d+)/)?.[1];
  const sidebar = serverId ? <ServerSidebar serverId={serverId} /> : <DMSidebar />;

  useEffect(() => {
    const page = params.get("settings");
    if (page) {
      openModal("settings", { page });
      params.delete("settings");
      setParams(params, { replace: true });
    }
  }, [params, setParams, openModal]);

  useEffect(() => {
    installVoice();
  }, []);

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
    document.body.style.overflow = leftOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [leftOpen, mobile]);

  // --- swiping the drawers -------------------------------------------------
  // The drawer follows the finger and snaps when it is let go, so it feels
  // like a drawer rather than a shortcut that either fires or does not.
  // `right` is a swipe that started with the member list open; it can only push that list away.
  const drag = useRef<{ x: number; y: number; t: number; axis: "" | "x" | "y"; from: boolean; right: boolean } | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  const drawerWidth = () => Math.min(420, Math.max(240, window.innerWidth - 56));

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
    const dx = t.clientX - d.x;
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
    const dx = t.clientX - d.x;
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
  const drawerStyle = dragging ? { transform: `translateX(${dragX - drawerWidth()}px)`, transition: "none" } : undefined;
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
          <div className={s.connection} data-state={connection}>{connection === "connecting" ? "Connecting…" : "Disconnected — reconnecting…"}</div>
        ) : null}
        <UpdateBanner />
        <RpcBanner />
        <DownloadBanner />
        {/* the page takes what the banner leaves */}
        <div className={s.page}>{children}</div>
      </div>
      <ModalHost />
      <Shortcuts />
      <DesktopEffects />
    </div>
  );
}
