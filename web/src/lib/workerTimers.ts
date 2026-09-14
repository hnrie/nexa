/**
 * setTimeout and clearTimeout run from a worker.
 *
 * Chromium slows the timers of a page that has been hidden for five minutes
 * (minimised, in the tray, behind another window, a background tab) to one
 * wake-up a minute. The gateway's 25 second heartbeat then went out about
 * once a minute, the server hung up on a connection silent for a minute, and
 * every message sent while it was down arrived without a notification. A
 * worker's timers are not held back that way, and the page still hears its
 * message straight away.
 *
 * Where a worker cannot be made, the page's own timers are used.
 */
type Handle = ReturnType<typeof setTimeout>;

const SOURCE = `
const timers = new Map();
onmessage = (e) => {
  const { op, id, ms } = e.data;
  if (op === "set") timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id); }, ms));
  else if (op === "clear") { clearTimeout(timers.get(id)); timers.delete(id); }
};
`;

let worker: Worker | null | undefined;
let nextId = 1;
const callbacks = new Map<number, () => void>();

function timerWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") return null;
    const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = (e: MessageEvent<number>) => {
      const fn = callbacks.get(e.data);
      callbacks.delete(e.data);
      fn?.();
    };
    w.onerror = () => {
      // a worker that fails later still hands its waiting timers to the page, rather than dropping them
      worker = null;
      for (const [id, fn] of callbacks) {
        callbacks.delete(id);
        globalThis.setTimeout(fn, 0);
      }
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Page timer handles are numbers in browsers; worker ones are told apart by a range of their own. */
const WORKER_BASE = 1 << 30;

export const workerSetTimeout = ((fn: () => void, ms: number): Handle => {
  const w = timerWorker();
  if (!w) return globalThis.setTimeout(fn, ms);
  const id = WORKER_BASE + nextId++;
  callbacks.set(id, fn);
  w.postMessage({ op: "set", id, ms: Math.max(0, ms) });
  return id as unknown as Handle;
}) as unknown as typeof setTimeout;

export const workerClearTimeout = ((handle: Handle | undefined): void => {
  if (handle === undefined || handle === null) return;
  const id = handle as unknown as number;
  if (typeof id === "number" && id >= WORKER_BASE && callbacks.has(id)) {
    callbacks.delete(id);
    worker?.postMessage({ op: "clear", id });
    return;
  }
  globalThis.clearTimeout(handle);
}) as unknown as typeof clearTimeout;
