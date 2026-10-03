/**
 * Swipe a message to reply, on a touch screen. Dragged against the reading
 * direction (leftward in English, rightward in Arabic) a message follows the
 * finger and a reply arrow shows at its end; past the line it ticks, and let
 * go there it replies. The Android app started it, and the web does the same
 * so the two feel alike.
 *
 * A swipe the other way, or one that starts mostly up or down, is left alone:
 * the list scrolls and the drawers open as before. While a row is being
 * swiped, `rowSwipeActive` tells the shell's drawer gesture to stand aside.
 */

/** How far the row follows the finger before letting go replies. */
export const REPLY_AT_PX = 56;
/** The furthest it moves, dragging behind the finger past the line. */
const MAX_PX = 84;
/** How far a finger moves before the swipe decides what it is. */
const SLOP_PX = 12;
/** Where a drag means something else: text being selected, a slider, a field. */
const NATIVE = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-native-press], [data-no-swipe]";

let active = false;

/** Whether a message row has this touch: the drawers leave it alone. */
export function rowSwipeActive(): boolean {
  return active;
}

/**
 * Listens on a message list for row swipes. `onReply` gets the row that was
 * pulled past the line; `canReply` says which rows can be (a message still
 * sending cannot). Returns the way to stop listening.
 */
export function installSwipeReply(root: HTMLElement, onReply: (row: HTMLElement) => void, canReply: (row: HTMLElement) => boolean = () => true): () => void {
  let start: { x: number; y: number; row: HTMLElement } | null = null;
  /** "" undecided, "swipe" this row's, "other" the list's or the drawer's. */
  let mode: "" | "swipe" | "other" = "";
  let armed = false;

  const dir = (): number => (getComputedStyle(root).direction === "rtl" ? 1 : -1);

  const reset = (row: HTMLElement): void => {
    const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset["reducedMotion"] === "true";
    row.removeAttribute("data-armed");
    if (reduced) {
      row.removeAttribute("data-swiping");
      row.style.removeProperty("--swipe");
      row.style.removeProperty("--swipe-p");
      return;
    }
    // back to its place, then the swipe styles go
    row.setAttribute("data-swipe-back", "");
    row.style.setProperty("--swipe", "0px");
    row.style.setProperty("--swipe-p", "0");
    window.setTimeout(() => {
      row.removeAttribute("data-swipe-back");
      row.removeAttribute("data-swiping");
      row.style.removeProperty("--swipe");
      row.style.removeProperty("--swipe-p");
    }, 240);
  };

  const onStart = (e: TouchEvent): void => {
    start = null;
    mode = "";
    armed = false;
    active = false;
    const t = e.touches[0];
    const target = e.target instanceof Element ? e.target : null;
    if (e.touches.length !== 1 || !t || !target || target.closest(NATIVE)) return;
    const row = target.closest<HTMLElement>("[role='article'][data-row]");
    if (!row || !root.contains(row) || !canReply(row)) return;
    start = { x: t.clientX, y: t.clientY, row };
  };

  const onMove = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!start || !t || mode === "other") return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const d = dir();
    if (mode === "") {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      // mostly sideways, and toward the end of the line
      if (Math.abs(dx) > 1.3 * Math.abs(dy) && dx * d > 0) {
        mode = "swipe";
        active = true;
        start.row.setAttribute("data-swiping", "");
      } else {
        mode = "other";
        return;
      }
    }
    if (e.cancelable) e.preventDefault();
    const pulled = Math.max(0, dx * d);
    // follows the finger, then drags behind it past the line
    const shown = Math.min(MAX_PX, pulled <= REPLY_AT_PX ? pulled : REPLY_AT_PX + (pulled - REPLY_AT_PX) * 0.35);
    start.row.style.setProperty("--swipe", `${d * shown}px`);
    start.row.style.setProperty("--swipe-p", String(Math.min(1, pulled / REPLY_AT_PX)));
    if (!armed && pulled >= REPLY_AT_PX) {
      armed = true;
      start.row.setAttribute("data-armed", "");
      try {
        navigator.vibrate?.(8);
      } catch {
        /* no haptics here */
      }
    } else if (armed && pulled < REPLY_AT_PX) {
      armed = false;
      start.row.removeAttribute("data-armed");
    }
  };

  const onEnd = (): void => {
    const s = start;
    const was = mode;
    start = null;
    mode = "";
    // the shell's touchend runs after this one: it still sees the swipe as the row's
    window.setTimeout(() => {
      active = false;
    }, 0);
    if (!s || was !== "swipe") return;
    if (armed) onReply(s.row);
    armed = false;
    reset(s.row);
  };

  root.addEventListener("touchstart", onStart, { passive: true });
  root.addEventListener("touchmove", onMove, { passive: false });
  root.addEventListener("touchend", onEnd);
  root.addEventListener("touchcancel", onEnd);
  return () => {
    root.removeEventListener("touchstart", onStart);
    root.removeEventListener("touchmove", onMove);
    root.removeEventListener("touchend", onEnd);
    root.removeEventListener("touchcancel", onEnd);
  };
}
