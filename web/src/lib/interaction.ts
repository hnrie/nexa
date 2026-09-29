/**
 * The last time the person did something in this window: pressed a key,
 * clicked or touched, or turned a wheel over it. Only input the browser says
 * came from the person (isTrusted) counts, so no script can make it up.
 *
 * Someone doing any of that is looking at the app, whatever its focus says.
 * The desktop app reports the window's focus a moment after the click that
 * gave it, a click into an embedded player takes focus away from the page, and
 * a window in the background can still be scrolled; read marks that waited on
 * focus alone missed all three.
 */
let last = Number.NEGATIVE_INFINITY;
let lastTold = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();
let installed = false;

/** How often listeners hear of a stream of input, such as a wheel turning. */
const TELL_EVERY_MS = 250;

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const note = (e: Event) => {
    if (!e.isTrusted) return;
    const now = performance.now();
    last = now;
    if (now - lastTold < TELL_EVERY_MS) return;
    lastTold = now;
    for (const fn of [...listeners]) fn();
  };
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, note, { capture: true, passive: true });
}

/** Whether the person did something in this window in the last `ms` milliseconds. */
export function interactedWithin(ms: number): boolean {
  install();
  return performance.now() - last <= ms;
}

/** Calls `fn` as the person does things in the window, a few times a second at most. */
export function onInteraction(fn: () => void): () => void {
  install();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tests: forget what was seen. */
export function resetInteraction(): void {
  last = Number.NEGATIVE_INFINITY;
  lastTold = Number.NEGATIVE_INFINITY;
}
