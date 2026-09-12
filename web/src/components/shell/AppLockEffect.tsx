import { useEffect } from "react";
import { loadLock } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
/** Re-arming on every mouse move would be wasteful; once a second is plenty. */
const ACTIVITY_THROTTLE = 1000;

/**
 * Locks the app on its own: after a stretch of inactivity, and when the window
 * goes to the background, for whoever asked for that in Security settings.
 */
export function AppLockEffect() {
  const status = useAuth((a) => a.status);
  const userId = useAuth((a) => a.me?.id);

  useEffect(() => {
    if (status !== "ready" || !userId) return;
    const cfg = loadLock(userId);
    if (!cfg || (cfg.autoLockMs <= 0 && !cfg.lockOnBlur)) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSeen = 0;

    const lock = () => useAuth.getState().lockApp();
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = cfg.autoLockMs > 0 ? setTimeout(lock, cfg.autoLockMs) : null;
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastSeen < ACTIVITY_THROTTLE) return;
      lastSeen = now;
      armIdle();
    };
    const leave = () => {
      if (!cfg.lockOnBlur || awayTimer) return;
      awayTimer = setTimeout(lock, cfg.blurDelayMs);
    };
    const back = () => {
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = null;
      armIdle();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back());

    armIdle();
    for (const ev of ACTIVITY) window.addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (awayTimer) clearTimeout(awayTimer);
      for (const ev of ACTIVITY) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [status, userId]);

  return null;
}
