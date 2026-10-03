import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "@/hooks/usePortalRoot";
import s from "./Popout.module.css";

const GAP = 8;

/** Beside what opened it: above when there is room, else below, always on screen. */
function place(anchor: DOMRect, box: DOMRect, prefer: "above" | "below"): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const above = anchor.top - box.height - GAP;
  const below = anchor.bottom + GAP;
  let top = prefer === "above" ? (above >= 4 ? above : below) : below + box.height <= vh - 4 ? below : above;
  top = Math.max(4, Math.min(top, vh - box.height - 4));
  // its left edge on what opened it, the way a menu lines up with its button
  const left = document.documentElement.dir === "rtl" ? anchor.right - box.width : anchor.left;
  return { left: Math.max(4, Math.min(left, vw - box.width - 4)), top };
}

/**
 * A small card that opens from something on the page (a server's tag beside
 * a name, someone's typing line) and says more about it. It lives at the end
 * of the page so nothing it opened from can clip it, takes focus when it
 * opens and gives it back when it closes, and goes away with a press
 * anywhere else, with Escape, or when what it opened from scrolls away.
 */
export function Popout({ anchor, onClose, label, children, className, prefer = "above", testId }: { anchor: HTMLElement; onClose: () => void; label: string; children: ReactNode; className?: string; prefer?: "above" | "below"; testId?: string }) {
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const inside = useRef(false);

  const reposition = useCallback(() => {
    const box = card.current?.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (!box) return;
    if (!anchor.isConnected || a.bottom < 0 || a.top > window.innerHeight) {
      onClose();
      return;
    }
    setAt(place(a, box, prefer));
  }, [anchor, onClose, prefer]);
  useLayoutEffect(reposition, [reposition, children]);

  const focused = useRef(false);
  useEffect(() => {
    if (!at || focused.current) return;
    focused.current = true;
    card.current?.focus({ preventScroll: true });
  }, [at]);
  useEffect(
    () => () => {
      if (inside.current && anchor.isConnected) anchor.focus({ preventScroll: true });
    },
    [anchor],
  );

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      // what opened it toggles it, so a press there is left to its own click
      if (card.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor, onClose, reposition]);

  return createPortal(
    <div
      ref={card}
      className={[s.popout, className ?? ""].join(" ")}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      onFocus={() => (inside.current = true)}
      onBlur={(e) => (inside.current = !!card.current?.contains(e.relatedTarget as Node))}
      style={at ? { left: at.left, top: at.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    portalRoot(),
  );
}
