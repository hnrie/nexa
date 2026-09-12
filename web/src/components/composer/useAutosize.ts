import { useLayoutEffect, type RefObject } from "react";

/** Grows a textarea with its content up to maxPx. */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx: number): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(maxPx, el.scrollHeight);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [ref, value, maxPx]);
}
