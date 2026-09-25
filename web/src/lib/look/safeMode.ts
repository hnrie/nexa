import { create } from "zustand";
import { storage } from "@/lib/storage";

/**
 * Safe mode: the app started with custom CSS and plugins off, for when one of
 * them has broken it. It is asked for with `?safe` on the address or from the
 * crash screen, and lasts for this tab until it is turned off. When the app
 * crashes again and again while plugins run, plugins alone are turned off the
 * same way on the next start, and the app says why.
 *
 * This module is small and imports nothing heavy, because main.tsx and the
 * crash screen read it before anything else has loaded.
 */

/** "manual": CSS and plugins off, as asked. "crashes": plugins off, because the app kept crashing with them. */
export type SafeMode = "manual" | "crashes" | null;

const FLAG = "ec:safe";
/** Set while this device has custom CSS or plugins on, so the crash screen knows to offer safe mode. */
const ACTIVE = "ec:look:active";
/** Crashes while plugins ran, and when the last was: `count:ms`. */
const CRASHES = "ec:look:crashes";
/** Two crashes this close together with plugins on turn them off. */
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 2;

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readFlag(): SafeMode {
  try {
    const v = session()?.getItem(FLAG);
    return v === "manual" || v === "crashes" ? v : null;
  } catch {
    return null;
  }
}

function writeFlag(v: SafeMode): void {
  try {
    if (v) session()?.setItem(FLAG, v);
    else session()?.removeItem(FLAG);
  } catch {
    /* a tab that cannot keep it starts normally next time */
  }
}

export const useSafeMode = create<{ mode: SafeMode }>()(() => ({ mode: null }));

export function safeMode(): SafeMode {
  return useSafeMode.getState().mode;
}

/** Custom CSS stays off: only when asked for. */
export const cssOff = (): boolean => safeMode() === "manual";
/** Plugins stay off: when asked for, or after the crashes. */
export const pluginsOff = (): boolean => safeMode() !== null;

function recentCrashes(): number {
  const [count, at] = (storage.get(CRASHES) ?? "").split(":").map(Number);
  if (!count || !at || Date.now() - at > CRASH_WINDOW_MS) return 0;
  return count;
}

/**
 * Decides, before the first render, whether this start is a safe one. `?safe`
 * is taken off the address once read, so a reload or a shared link does not
 * carry it on.
 */
export function initSafeMode(): SafeMode {
  let mode = readFlag();
  if (typeof location !== "undefined") {
    const params = new URLSearchParams(location.search);
    if (params.has("safe")) {
      mode = "manual";
      params.delete("safe");
      const rest = params.toString();
      try {
        history.replaceState(history.state, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
      } catch {
        /* the address keeps it; harmless */
      }
    }
  }
  if (!mode && recentCrashes() >= CRASH_LIMIT) {
    mode = "crashes";
    storage.remove(CRASHES);
  }
  writeFlag(mode);
  useSafeMode.setState({ mode });
  return mode;
}

/** Starts again with custom CSS and plugins off. */
export function enterSafeMode(): void {
  writeFlag("manual");
  window.location.reload();
}

/** Starts again with everything the account has turned on. */
export function leaveSafeMode(): void {
  writeFlag(null);
  storage.remove(CRASHES);
  window.location.reload();
}

/** Whether custom CSS or plugins were on here last time, which is when safe mode is worth offering. */
export function lookActive(): boolean {
  return storage.get(ACTIVE) === "1";
}

export function setLookActive(on: boolean): void {
  if (on) storage.set(ACTIVE, "1");
  else storage.remove(ACTIVE);
}

/** The crash screen counts crashes that happen while plugins are running. */
export function noteCrash(): void {
  if (!lookActive()) return;
  storage.set(CRASHES, `${recentCrashes() + 1}:${Date.now()}`);
}

/** The app has run with its plugins for a while: earlier crashes are forgiven. */
export function noteHealthy(): void {
  storage.remove(CRASHES);
}
