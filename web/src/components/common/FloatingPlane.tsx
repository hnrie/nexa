/**
 * A picture that sits on a plane of its own.
 *
 * It floats gently on its own, and tips towards the pointer as it passes, the
 * way a card held loosely in a hand would. The tilt is small on purpose: this
 * is meant to read as depth, not as a toy.
 *
 * Nothing moves on a touch screen, where there is no pointer to follow, or for
 * anyone who asked for less motion.
 */
import { useEffect, useRef, type ReactNode } from "react";
import s from "./FloatingPlane.module.css";

/** How far it tips, in degrees, at the very corner. */
const TILT = 5;

export function FloatingPlane({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = el.getBoundingClientRect();
        // -1 to 1 from the middle of the picture, clamped so a pointer far
        // away does not fling it
        const x = Math.max(-1, Math.min(1, (e.clientX - (box.left + box.width / 2)) / (box.width / 2)));
        const y = Math.max(-1, Math.min(1, (e.clientY - (box.top + box.height / 2)) / (box.height / 2)));
        el.style.setProperty("--rx", `${(-y * TILT).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * TILT).toFixed(2)}deg`);
        el.style.setProperty("--lift", Math.abs(x) + Math.abs(y) < 1.6 ? "1" : "0");
      });
    };
    const rest = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--lift", "0");
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", rest);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", rest);
    };
  }, []);

  return (
    <div className={[s.stage, className].filter(Boolean).join(" ")}>
      <div ref={ref} className={s.plane}>
        {children}
      </div>
    </div>
  );
}
