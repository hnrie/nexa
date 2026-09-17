/**
 * Text that scrolls itself when it does not fit.
 *
 * A status is often longer than the space under a name, and an ellipsis cuts
 * it off exactly where the interesting part starts. This measures the words
 * against their box and, when they overflow, slides them across and back with
 * a pause at each end, so the whole thing can be read without hovering or
 * opening anything.
 *
 * Nothing moves when it fits, and nothing moves for anyone who asked for less
 * motion — they get the ellipsis, which is the honest fallback.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./ScrollingText.module.css";

/** How long the text rests at each end before it travels back. */
const DWELL_MS = 1600;
/** How fast it travels, in pixels per second. */
const SPEED = 26;

export function ScrollingText({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);

  useEffect(() => {
    const outer = box.current;
    const text = inner.current;
    if (!outer || !text) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const measure = () => {
      // a fraction of a pixel is rounding, not overflow
      const diff = Math.round(text.scrollWidth - outer.clientWidth);
      setOver(diff > 1 ? diff : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(text);
    return () => ro.disconnect();
  }, [children]);

  const travel = over > 0 ? (over / SPEED) * 1000 : 0;
  return (
    <span ref={box} className={[s.box, className].filter(Boolean).join(" ")}>
      <span
        ref={inner}
        className={s.inner}
        data-scrolling={over > 0 || undefined}
        style={over > 0 ? ({ "--shift": `${-over}px`, "--dur": `${Math.round(travel * 2 + DWELL_MS * 2)}ms` } as React.CSSProperties) : undefined}
      >
        {children}
      </span>
    </span>
  );
}
