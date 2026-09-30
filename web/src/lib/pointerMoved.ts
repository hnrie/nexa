/**
 * Whether a mouse event came from someone moving the mouse on purpose.
 *
 * A list that appears or changes under a pointer standing still gets mouse
 * events all the same. Firefox and Safari tell the row that has landed under
 * the pointer that the mouse is over it; Chromium does so after a key press,
 * or at the slightest twitch of a hand resting on the mouse or the trackpad.
 * A list that chose whatever was hovered took the choice from the keyboard's
 * that way, while someone was typing and never touched the mouse.
 *
 * So after a key press the pointer has to travel a few pixels before it
 * counts as moving again, and a mousemove counts only when it is somewhere
 * the last one was not. Every mousemove on the page passes through here first
 * (capturing listeners on the window run before the page's own).
 */

/** How far the pointer has to go after a key press before it counts as moved. */
const TRAVEL = 6;

let x = Number.NaN;
let y = Number.NaN;
/** A key has been pressed since the pointer last went anywhere. */
let still = false;
/** Where the pointer was when that key was pressed, once known. */
let from: { x: number; y: number } | null = null;
let lastMoved: Event | null = null;

function onMove(e: MouseEvent): void {
  // the first one ever seen cannot say it moved: there is nowhere to have moved from
  const moved = !Number.isNaN(x) && (e.screenX !== x || e.screenY !== y);
  x = e.screenX;
  y = e.screenY;
  if (still) {
    if (!from) {
      from = { x, y };
      return;
    }
    if (Math.hypot(x - from.x, y - from.y) < TRAVEL) return;
    still = false;
    from = null;
  }
  if (moved) lastMoved = e;
}

function onKey(): void {
  still = true;
  from = Number.isNaN(x) ? null : { x, y };
}

if (typeof window !== "undefined") {
  window.addEventListener("mousemove", onMove, { capture: true, passive: true });
  window.addEventListener("keydown", onKey, { capture: true, passive: true });
}

/** True when this mousemove took the pointer somewhere new, on purpose. */
export function pointerMoved(e: Event): boolean {
  return e === lastMoved;
}
