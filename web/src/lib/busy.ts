/**
 * Work a page reload would cut off: an upload, a message on its way, a call.
 * When a deploy brings a new version of the app, the page waits for all of it
 * to finish before reloading onto the new one, and says what it waits for.
 */

/** What is holding a reload off. */
export type ReloadHold = "call" | "upload" | "send";

/** In the order they are worth mentioning: a call outlasts an upload, which outlasts a send. */
const ORDER: ReloadHold[] = ["call", "upload", "send"];

const holds = new Map<ReloadHold, number>();
let waiters: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** How long nothing may be held before a reload goes ahead. */
const QUIET_MS = 1000;

const held = (): number => [...holds.values()].reduce((a, b) => a + b, 0);

/** Holds off reloading the page until the returned function is called. Calling it again does nothing. */
export function holdReload(what: ReloadHold): () => void {
  holds.set(what, (holds.get(what) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holds.get(what) ?? 1) - 1;
    if (left > 0) holds.set(what, left);
    else holds.delete(what);
    if (held() === 0) settleSoon();
  };
}

/** What is holding a reload off right now, the longest-lasting kind first. */
export function reloadHolds(): ReloadHold[] {
  return ORDER.filter((what) => (holds.get(what) ?? 0) > 0);
}

function settleSoon(): void {
  if (timer !== null || waiters.length === 0) return;
  // One step often starts right as another ends (an upload, then the message
  // carrying it), so wait a moment for the next before calling it quiet.
  timer = setTimeout(() => {
    timer = null;
    if (held() > 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }, QUIET_MS);
}

/** Resolves once nothing has been holding off a reload for a moment. */
export function reloadAllowed(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (held() === 0) settleSoon();
  });
}
