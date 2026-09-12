import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Rail } from "@/components/rail/Rail";
import { DMSidebar } from "@/components/sidebar/DMSidebar";
import { ServerSidebar } from "@/components/sidebar/ServerSidebar";
import { ModalHost } from "@/components/modals/ModalHost";
import { Shortcuts } from "@/components/shell/Shortcuts";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUI } from "@/stores/ui";
import s from "./AppShell.module.css";

/** Three-pane desktop layout; on phones the rail+sidebar live in a left drawer. */
export function AppShell({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  const leftOpen = useUI((u) => u.leftOpen);
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
    setLeftOpen(false);
    setRightOpen(false);
  }, [loc.pathname, setLeftOpen, setRightOpen]);

  useEffect(() => {
    if (!mobile) return;
    document.body.style.overflow = leftOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [leftOpen, mobile]);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touch.current = { x: t.clientX, y: t.clientY, edge: t.clientX < 28 };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t || !mobile) return;
    const dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    if (dy > 60) return;
    if (start.edge && dx > 60) setLeftOpen(true);
    else if (leftOpen && dx < -60) setLeftOpen(false);
  };

  return (
    <div className={s.app} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {mobile ? (
        <>
          <div className={s.backdrop} data-open={leftOpen} onClick={() => setLeftOpen(false)} />
          <div className={s.drawer} data-open={leftOpen}>
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
        {children}
      </div>
      <ModalHost />
      <Shortcuts />
    </div>
  );
}
