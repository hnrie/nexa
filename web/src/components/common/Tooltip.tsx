import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "@/hooks/usePortalRoot";
import s from "./Tooltip.module.css";

type Side = "top" | "right" | "bottom" | "left";

interface Props {
  text: string;
  side?: Side;
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Touch devices report a hover that never ends, which strands tooltips on screen. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

const GAP = 8;

/** Places the bubble beside the trigger, nudged back on screen if it would not fit, with where its arrow points. */
function place(anchor: DOMRect, box: DOMRect, side: Side): { left: number; top: number; side: Side; arrow: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.left + anchor.width / 2 - box.width / 2;
  let top = anchor.top - box.height - GAP;
  if (side === "bottom") top = anchor.bottom + GAP;
  if (side === "left" || side === "right") {
    top = anchor.top + anchor.height / 2 - box.height / 2;
    left = side === "left" ? anchor.left - box.width - GAP : anchor.right + GAP;
  }
  // a bubble above the very top of the window flips below, and the reverse
  let placed = side;
  if (side === "top" && top < 4) {
    top = anchor.bottom + GAP;
    placed = "bottom";
  } else if (side === "bottom" && top + box.height > vh - 4) {
    top = anchor.top - box.height - GAP;
    placed = "top";
  }
  left = Math.max(4, Math.min(left, vw - box.width - 4));
  top = Math.max(4, Math.min(top, vh - box.height - 4));
  // the arrow stays on the trigger's middle even when the bubble was pushed along the edge
  const along = placed === "top" || placed === "bottom" ? anchor.left + anchor.width / 2 - left : anchor.top + anchor.height / 2 - top;
  const length = placed === "top" || placed === "bottom" ? box.width : box.height;
  return { left, top, side: placed, arrow: Math.max(10, Math.min(length - 10, along)) };
}

/**
 * A hover tooltip drawn straight onto the page rather than inside whatever it
 * labels. A message row clips what paints outside it, so a bubble rendered in
 * place there is simply never seen.
 */
export function Tooltip({ text, side = "top", children, className, delay = 250 }: Props) {
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number; side: Side; arrow: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  // measured after it is in the DOM, so the bubble's own size is known
  useEffect(() => {
    if (!open) return;
    const anchor = wrap.current?.getBoundingClientRect();
    const box = bubble.current?.getBoundingClientRect();
    if (anchor && box) setAt(place(anchor, box, side));
  }, [open, side, text]);

  const show = () => {
    if (coarsePointer()) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
    setAt(null);
  };

  return (
    <span
      ref={wrap}
      className={[s.wrap, className ?? ""].join(" ")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
      onClick={hide}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={bubble}
              className={s.tip}
              role="tooltip"
              data-side={at?.side ?? side}
              style={at ? ({ left: at.left, top: at.top, "--arrow": `${at.arrow}px` } as React.CSSProperties) : { left: -9999, top: -9999 }}
            >
              {text}
            </span>,
            // tooltips come and go too often to each follow full screen; they look where to mount as they open
            portalRoot(),
          )
        : null}
    </span>
  );
}
