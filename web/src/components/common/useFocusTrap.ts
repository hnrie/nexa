import { useEffect, type RefObject } from "react";
import { isTopLayer } from "./Modal";

/** What Tab can reach inside a trapped layer. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a layer while it is the top one: Tab and
 * Shift+Tab wrap around its own controls instead of walking into the page
 * behind it, where Enter would act on something nobody can see. Focus moves
 * into the layer when it opens (to `initial`, or the layer itself) and goes
 * back where it was when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initial?: () => HTMLElement | null | undefined): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !isTopLayer(ref.current)) return;
      const layer = ref.current;
      if (!layer) return;
      const all = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)];
      // Laid-out stops only, so a hidden tab's contents are not in the cycle —
      // unless nothing reports a box at all (no layout, as in tests).
      const shown = all.filter((el) => el.getClientRects().length > 0);
      const stops = shown.length > 0 ? shown : all;
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (!layer.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    const target = initial?.() ?? ref.current;
    target?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
    // the layer is the same element for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
