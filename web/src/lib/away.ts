/**
 * Idle by itself. After a while with nothing done in Nexa — no key pressed,
 * nothing clicked, tapped or scrolled — this device tells the server that its
 * person is away, and anything done here says they are back. The server shows
 * an account whose status is Online as Idle only while every one of its
 * devices says so, so reading on a phone keeps someone Online while their
 * computer sits untouched; a status chosen by hand (Idle, Do Not Disturb,
 * Invisible) is never changed. Being in a call counts as being here. Settings
 * → Privacy & Safety turns it off.
 */
import { gateway } from "@/gateway/session";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoice } from "@/stores/voice";

/** How long nothing has to happen before this device counts as away. */
export const AWAY_AFTER = 10 * 60_000;

let lastActive = Date.now();
let reported = false;
let installed = false;

/** Whether this device counts as away right now. */
export function isAway(now: number, last: number, on: boolean, inCall: boolean): boolean {
  // talking in a call is being here, hands on the keyboard or not
  return on && !inCall && now - last >= AWAY_AFTER;
}

function report(again = false): void {
  const away = isAway(Date.now(), lastActive, useSettings.getState().settings.autoIdle !== false, !!useVoice.getState().mine);
  if (away === reported && !again) return;
  reported = away;
  gateway()?.sendAway(away);
}

function active(): void {
  lastActive = Date.now();
  if (reported) report();
}

export function installAway(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const opts = { passive: true, capture: true } as const;
  for (const ev of ["keydown", "pointerdown", "wheel", "touchstart"] as const) window.addEventListener(ev, active, opts);
  // a moving pointer is noticed now and then, not on every pixel
  let moved = 0;
  window.addEventListener(
    "pointermove",
    () => {
      const now = Date.now();
      if (now - moved < 5000) return;
      moved = now;
      active();
    },
    opts,
  );
  window.addEventListener("focus", active);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") active();
  });
  setInterval(() => report(), 15_000);
  // a new connection starts out present, so one made while away says so again
  useUI.subscribe((s, prev) => {
    if (s.connection === "open" && prev.connection !== "open" && reported) report(true);
  });
  useSettings.subscribe((s, prev) => {
    if (s.settings.autoIdle !== prev.settings.autoIdle) report();
  });
  useVoice.subscribe((s, prev) => {
    if (!!s.mine !== !!prev.mine) report();
  });
}
