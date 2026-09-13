/**
 * Work a page reload would cut off: an upload, a message on its way, a call.
 * When a deploy brings a new version of the app, the page waits for all of it
 * to finish before reloading onto the new one.
 */

let held = 0;
let waiters: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** How long nothing may be held before a reload goes ahead. */
const QUIET_MS = 1000;

/** Holds off reloading the page until the returned function is called. Calling it again does nothing. */
export function holdReload(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
    if (held === 0) settleSoon();
  };
}

function settleSoon(): void {
  if (timer !== null || waiters.length === 0) return;
  // One step often starts right as another ends (an upload, then the message
  // carrying it), so wait a moment for the next before calling it quiet.
  timer = setTimeout(() => {
    timer = null;
    if (held > 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }, QUIET_MS);
}

/** Resolves once nothing has been holding off a reload for a moment. */
export function reloadAllowed(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (held === 0) settleSoon();
  });
}
