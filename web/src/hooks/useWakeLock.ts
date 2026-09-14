import { useEffect } from "react";

type WakeLock = { release: () => Promise<void>; addEventListener: (type: "release", cb: () => void) => void };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };

/**
 * Keeps a phone's screen from dimming and locking while `active`, say while
 * watching someone's camera or screen. The browser drops the lock whenever
 * the page is hidden, so it is taken again on coming back. Browsers without
 * the API (iOS before 16.4) simply sleep as usual.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const nav = (typeof navigator === "undefined" ? undefined : navigator) as WakeLockNavigator | undefined;
    if (!active || !nav?.wakeLock) return;
    let lock: WakeLock | null = null;
    let asking = false;
    let alive = true;
    const take = () => {
      // one request at a time: a second one answered later would leave the first lock held for good
      if (lock || asking || document.visibilityState !== "visible") return;
      asking = true;
      nav.wakeLock!.request("screen").then(
        (l) => {
          asking = false;
          if (!alive) {
            void l.release().catch(() => {});
            return;
          }
          lock = l;
          l.addEventListener("release", () => {
            if (lock === l) lock = null;
          });
        },
        () => {
          asking = false;
          /* refused, e.g. battery saver: the screen just sleeps as usual */
        },
      );
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}
