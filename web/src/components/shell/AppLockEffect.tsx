import { useEffect } from "react";
import { loadLock } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
/** Re-arming on every mouse move would be wasteful; once a second is plenty. */
const ACTIVITY_THROTTLE = 1000;
/**
 * The shortest wait after the window loses focus while the page stays visible.
 * Short blurs happen while the app is still in use (a permission prompt, a
 * system sheet), and locking tears the whole UI down.
 */
const BLUR_GRACE = 2000;
/** How soon after a blur to check where focus went. */
const FOCUS_POLL = 500;

/**
 * Locks the app on its own: after a stretch of inactivity, and when the window
 * goes to the background, for whoever asked for that in Security settings.
 */
export function AppLockEffect() {
  const status = useAuth((a) => a.status);
  const userId = useAuth((a) => a.me?.id);
  // Setting a passcode or changing its timings bumps this, so the timers
  // below are rebuilt from what was just saved.
  const lockVersion = useAuth((a) => a.lockVersion);

  useEffect(() => {
    if (status !== "ready" || !userId) return;
    const cfg = loadLock(userId);
    if (!cfg || (cfg.autoLockMs <= 0 && !cfg.lockOnBlur)) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    let awayAt = 0;
    let focusPoll: ReturnType<typeof setInterval> | null = null;
    let lastSeen = 0;
    // A file chooser takes focus, and on Android hides the page, while the
    // user is still attaching something. Locking then would unmount the input
    // and lose the files they pick.
    let picking = false;

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
    const leave = (delay: number) => {
      if (!cfg.lockOnBlur || picking) return;
      // A hidden page follows a blur that already waits out the grace; it must
      // not wait that long, because a phone suspends the page soon after.
      if (awayTimer && Date.now() + delay >= awayAt) return;
      if (awayTimer) clearTimeout(awayTimer);
      awayAt = Date.now() + delay;
      awayTimer = setTimeout(lock, delay);
    };
    const stopFocusPoll = () => {
      if (focusPoll) clearInterval(focusPoll);
      focusPoll = null;
    };
    const onBlur = () => {
      if (!cfg.lockOnBlur || focusPoll) return;
      // Clicking into a video embed blurs the window without leaving the app:
      // the document still has focus then. Keep checking, and start the wait
      // only once focus has really gone to another window.
      focusPoll = setInterval(() => {
        if (document.hasFocus()) return;
        stopFocusPoll();
        leave(Math.max(cfg.blurDelayMs, BLUR_GRACE));
      }, FOCUS_POLL);
    };
    const back = () => {
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = null;
      picking = false;
      stopFocusPoll();
      armIdle();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return back();
      stopFocusPoll();
      leave(cfg.blurDelayMs);
    };
    const donePicking = () => {
      picking = false;
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "file") return;
      picking = true;
      el.addEventListener("change", donePicking, { once: true });
      el.addEventListener("cancel", donePicking, { once: true });
    };

    armIdle();
    for (const ev of ACTIVITY) window.addEventListener(ev, onActivity, { passive: true });
    // Touching the app again means any chooser has closed, even in a browser
    // that sends no cancel event for it.
    window.addEventListener("pointerdown", donePicking, true);
    window.addEventListener("keydown", donePicking, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", back);
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (awayTimer) clearTimeout(awayTimer);
      stopFocusPoll();
      for (const ev of ACTIVITY) window.removeEventListener(ev, onActivity);
      window.removeEventListener("pointerdown", donePicking, true);
      window.removeEventListener("keydown", donePicking, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
    };
  }, [status, userId, lockVersion]);

  return null;
}
