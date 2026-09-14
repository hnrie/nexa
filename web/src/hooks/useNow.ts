import { useSyncExternalStore } from "react";

/**
 * The current time, ticking once a second while anything is watching it. All
 * the clocks on screen (activity timers and progress bars) share one timer,
 * which stops when the last of them goes away.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const idle = () => () => {};

/** Date.now(), refreshed every second while `active`. */
export function useNow(active = true): number {
  return useSyncExternalStore(active ? subscribe : idle, () => (active ? now : 0), () => 0) || Date.now();
}
