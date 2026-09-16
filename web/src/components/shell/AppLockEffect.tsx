import { useEffect } from "react";
import { loadLock } from "@/lib/appLock";
import { desktopBridge } from "@/lib/desktopBridge";
import { useAuth } from "@/stores/auth";

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
/** Re-arming on every mouse move would be wasteful; once a second is plenty. */
const ACTIVITY_THROTTLE = 1000;
/**
 * How long to wait after a blur before deciding focus really left. Short blurs
 * happen while the app is still in use (a permission prompt, a system sheet),
 * and locking tears the whole UI down.
 */
const BLUR_SETTLE = 700;

/**
 * Whether the blur that just happened moved focus into the page itself — a
 * video embed, a captcha frame — rather than out of the window. The browser
 * reports that as the iframe becoming the active element while the document
 * keeps focus.
 */
function focusWentIntoThePage(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLIFrameElement && document.hasFocus();
}

/**
 * Locks the app on its own: after a stretch of inactivity, and when the window
 * goes to the background, for whoever asked for that in Security settings.
 *
 * Where the window is comes from three sources, because no one of them answers
 * everywhere. The desktop app's own window manager is authoritative when it is
 * there (a page inside Electron reports focus it does not have). A browser tab
 * that goes to the background raises visibilitychange. Moving to another app,
 * which leaves the tab visible, raises only blur.
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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
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
    const clearSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
    };
    /** Starts the countdown to locking, unless a shorter one is already running. */
    const leave = (delay: number) => {
      if (!cfg.lockOnBlur || picking) return;
      clearSettle();
      if (awayTimer && awayAt <= Date.now() + delay) return;
      if (awayTimer) clearTimeout(awayTimer);
      awayAt = Date.now() + delay;
      awayTimer = setTimeout(() => {
        awayTimer = null;
        lock();
      }, delay);
    };
    /** A blur may still be the page's own; give it a moment to say so. */
    const maybeLeave = (delay: number) => {
      if (!cfg.lockOnBlur || picking || awayTimer || settleTimer) return;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (focusWentIntoThePage()) return;
        leave(delay);
      }, BLUR_SETTLE);
    };
    const back = () => {
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = null;
      picking = false;
      clearSettle();
      armIdle();
    };
    const onBlur = () => maybeLeave(cfg.blurDelayMs);
    const onVisibility = () => {
      // A phone suspends a hidden page soon after, so this one does not settle.
      if (document.visibilityState === "hidden") leave(cfg.blurDelayMs);
      else back();
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
    // The desktop app knows where its own window is; nothing in the page does.
    const bridge = desktopBridge();
    const offWindow = bridge?.onWindowState?.((w) => (w.focused && w.visible && !w.minimized ? back() : leave(cfg.blurDelayMs)));
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (awayTimer) clearTimeout(awayTimer);
      clearSettle();
      for (const ev of ACTIVITY) window.removeEventListener(ev, onActivity);
      window.removeEventListener("pointerdown", donePicking, true);
      window.removeEventListener("keydown", donePicking, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
      offWindow?.();
    };
  }, [status, userId, lockVersion]);

  return null;
}
