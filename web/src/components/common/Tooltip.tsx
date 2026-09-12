import { useState, type ReactNode } from "react";
import s from "./Tooltip.module.css";

interface Props {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** A hover/focus tooltip; the child gets an aria-label when it is a plain icon. */
export function Tooltip({ text, side = "top", children, className, delay = 250 }: Props) {
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setOpen(true), delay));
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    setTimer(null);
    setOpen(false);
  };
  return (
    <span className={[s.wrap, className ?? ""].join(" ")} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open ? (
        <span className={[s.tip, s[side]].join(" ")} role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}
