import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./Tooltip.module.css";

interface Props {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Touch devices report a hover that never ends, which strands tooltips on screen. */
function coarsePointer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

/** A hover/focus tooltip; the child gets an aria-label when it is a plain icon. */
export function Tooltip({ text, side = "top", children, className, delay = 250 }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const show = () => {
    if (coarsePointer()) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };
  return (
    <span
      className={[s.wrap, className ?? ""].join(" ")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
      onClick={hide}
    >
      {children}
      {open ? (
        <span className={[s.tip, s[side]].join(" ")} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}
