/**
 * Knowing when a new version of Nexa is out, and moving onto it.
 *
 * A deploy writes a new build of the web app, and version.json beside it
 * names that build (vite.config.ts). An open page compares the name with its
 * own: every ten minutes, when it comes back into view, when the gateway
 * reconnects (a deploy restarts the server) and when a new service worker
 * takes over (main.tsx). The desktop app says for itself when it has a new
 * version of its own (stores/desktop.ts). Either way the update is offered
 * (components/shell/UpdateDialog.tsx), and moving onto it waits for anything a
 * reload or a restart would cut off: a call, an upload, a message on its way,
 * a download.
 */
import { create } from "zustand";
import { useDesktop } from "@/stores/desktop";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { reloadAllowed, reloadHolds, type ReloadHold } from "./busy";
import { desktopBridge } from "./desktopBridge";
import { downloading, downloadsSettled } from "./download";
import { wordsInFocus } from "./interrupt";

/** This page's own build. */
export const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";

/** How often an open page asks, whatever else happens. */
const CHECK_EVERY = 10 * 60_000;
/** Focus and coming back into view ask again, but not more often than this. */
const CHECK_AT_MOST = 60_000;
/** Checks nothing else throttles (the gateway back, a new worker) still keep this far apart. */
const CHECK_MIN_GAP = 5_000;
/** After Later, the prompt waits this long before it asks again. */
export const SNOOZE_MS = 2 * 60 * 60_000;
/** A page out of sight this long, with nothing going on in it, reloads onto a new build by itself. */
export const HIDDEN_RELOAD_MS = 10 * 60_000;
/** How long the settings save before a reload may take; after that the page's own going-away save carries it. */
const FLUSH_MS = 3_000;

export type Applying = "reload" | "restart";

/** What a reload or a restart is waiting for, as the prompt says it. */
export type Waiting = ReloadHold | "download" | "update" | "typing" | null;

interface AppUpdateState {
  /** The newer build of the web app the server has, once one is seen. */
  web: string | null;
  /** The update the prompt was put off for with Later, and until when. */
  snoozed: { key: string; until: number } | null;
  /** Reload or Update was pressed, and it is waiting for its moment. */
  applying: Applying | null;
  waiting: Waiting;
}

export const useAppUpdate = create<AppUpdateState>(() => ({ web: null, snoozed: null, applying: null, waiting: null }));

// --- finding out ---------------------------------------------------------

const BUILD_ID = /^[0-9a-z]{1,24}$/;
let lastCheck = 0;

/**
 * Asks the server which build it serves. True when that is not this page's
 * build: a deploy has happened since this page loaded (or, after a rollback,
 * the server's build is older, which is just as much the one to be on).
 */
export async function checkForUpdate(opts: { current?: string; fetcher?: typeof fetch } = {}): Promise<boolean> {
  const current = opts.current ?? BUILD;
  if (!current) return false;
  lastCheck = Date.now();
  try {
    const res = await (opts.fetcher ?? fetch)("/version.json", { cache: "no-store", credentials: "omit" });
    if (!res.ok) return false;
    const data = (await res.json()) as { build?: unknown } | null;
    const build = data && typeof data.build === "string" && BUILD_ID.test(data.build) ? data.build : null;
    if (!build || build === current) return false;
    if (useAppUpdate.getState().web !== build) useAppUpdate.setState({ web: build });
    return true;
  } catch {
    // offline, the server restarting, a page that is not JSON: nothing is known
    return false;
  }
}

/** A new service worker took over: a deploy is the usual reason, so look now. */
export function noteNewWorker(): void {
  if (Date.now() - lastCheck >= CHECK_MIN_GAP) void checkForUpdate();
}

/**
 * Starts asking, and moves a page nobody is looking at onto a new build by
 * itself. Returns what stops it. Nothing happens on the dev server, whose
 * build changes with every edit.
 */
export function startUpdateChecks(opts: { build?: string; enabled?: boolean } = {}): () => void {
  const build = opts.build ?? BUILD;
  if (!build || !(opts.enabled ?? !import.meta.env.DEV) || typeof window === "undefined") return () => undefined;
  const check = (gap: number) => {
    if (Date.now() - lastCheck >= gap) void checkForUpdate({ current: build });
  };
  const every = setInterval(() => check(CHECK_MIN_GAP), CHECK_EVERY);
  const onFocus = () => check(CHECK_AT_MOST);
  let hiddenSince = document.visibilityState === "hidden" ? Date.now() : 0;
  const onVisibility = () => {
    hiddenSince = document.visibilityState === "hidden" ? Date.now() : 0;
    if (!hiddenSince) check(CHECK_AT_MOST);
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  // a deploy restarts the server, so the gateway coming back is the moment to look
  const offGateway = useUI.subscribe((ui, prev) => {
    if (ui.connection === "open" && prev.connection !== "open") check(CHECK_MIN_GAP);
  });
  // An update is only ever applied in front of someone who asked for it,
  // except here: a page out of sight for a while, with nothing going on in
  // it, reloads onto the new build so it is current when its person comes
  // back, and What's New tells them what changed. Nothing is lost: drafts are
  // kept with the account, and anything in flight or open keeps it waiting.
  const idle = setInterval(() => {
    if (!hiddenSince || Date.now() - hiddenSince < HIDDEN_RELOAD_MS) return;
    const st = useAppUpdate.getState();
    if (!st.web || st.applying || !nothingGoingOn()) return;
    void applyUpdate("reload", { unattended: true });
  }, 60_000);
  return () => {
    clearInterval(every);
    clearInterval(idle);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    offGateway();
  };
}

/** Whether a reload now would lose nothing: nothing in flight, nothing open, nothing playing, nothing half written. */
export function nothingGoingOn(): boolean {
  if (reloadHolds().length > 0 || downloading()) return false;
  const ui = useUI.getState();
  if (ui.modals.length > 0 || ui.editing || ui.replyTo || ui.quickSwitcher) return false;
  if (document.querySelector("[data-modal-layer]")) return false;
  if ([...document.querySelectorAll<HTMLMediaElement>("audio, video")].some((m) => !m.paused && !m.ended)) return false;
  return !wordsInFocus();
}

// --- moving onto it ------------------------------------------------------

let generation = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How the page reloads, held here so a test can stand in for it (a real reload ends the test). */
export const page = { reload: (): void => window.location.reload() };

/** What is keeping the update waiting right now, if anything. */
function currentWait(): Waiting {
  const hold = reloadHolds()[0];
  if (hold) return hold;
  if (downloading()) return "download";
  return wordsInFocus() ? "typing" : null;
}

/**
 * Resolves once nothing would be cut off: no call, upload, message on its
 * way or download, and no words sitting in the box being written in.
 */
async function quiet(still: () => boolean): Promise<void> {
  // what is said is kept current: a call can end while an upload goes on
  const show = () => {
    if (still()) useAppUpdate.setState({ waiting: currentWait() });
  };
  show();
  const timer = setInterval(show, 1000);
  try {
    for (;;) {
      await reloadAllowed();
      await downloadsSettled();
      if (!still()) return;
      const wait = currentWait();
      if (!wait) return;
      if (wait === "typing") await sleep(1000);
    }
  } finally {
    clearInterval(timer);
  }
}

/** Resolves true once the desktop app has its new version downloaded, false if the download stopped. */
function desktopReady(still: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    let off: () => void = () => undefined;
    const look = (): boolean => {
      const status = useDesktop.getState().update?.status;
      if (!still()) resolve(false);
      else if (status === "ready") resolve(true);
      else if (status !== "downloading") resolve(false);
      else return false;
      return true;
    };
    if (look()) return;
    off = useDesktop.subscribe(() => {
      if (look()) off();
    });
  });
}

/**
 * Moves onto the new version: a reload onto the new build of the web app, or
 * a restart into the desktop app's new version, the moment nothing would be
 * cut off. `unattended` is a reload of a page nobody is looking at, which
 * gives up if someone comes back to it first.
 */
export async function applyUpdate(how: Applying, opts: { unattended?: boolean } = {}): Promise<void> {
  const gen = ++generation;
  const still = () => gen === generation && (!opts.unattended || document.visibilityState === "hidden");
  useAppUpdate.setState({ applying: how, waiting: null });
  const stop = () => {
    if (gen === generation) useAppUpdate.setState({ applying: null, waiting: null });
  };
  if (how === "restart" && useDesktop.getState().update?.status !== "ready") {
    useAppUpdate.setState({ waiting: "update" });
    if (!(await desktopReady(still))) return stop();
  }
  await quiet(still);
  if (!still()) return stop();
  useAppUpdate.setState({ waiting: null });
  // drafts and every other setting changed a moment ago go with the page
  await Promise.race([useSettings.getState().flush(), sleep(FLUSH_MS)]);
  if (!still()) return stop();
  if (how === "restart") {
    const bridge = desktopBridge();
    if (!bridge) return stop();
    await bridge.updates.restart();
    return;
  }
  page.reload();
}

/** Puts off moving onto the new version (Cancel, while it waits). */
export function cancelUpdate(): void {
  generation += 1;
  useAppUpdate.setState({ applying: null, waiting: null });
}

/** Later: the prompt for this update stays tucked away for a while. A newer update asks at once. */
export function snoozeUpdate(key: string, now = Date.now()): void {
  useAppUpdate.setState({ snoozed: { key, until: now + SNOOZE_MS } });
}

/** Whether the prompt for this update was put off, and is still. */
export function isSnoozed(key: string, snoozed: AppUpdateState["snoozed"], now = Date.now()): boolean {
  return !!snoozed && snoozed.key === key && now < snoozed.until;
}

/** For tests: back to a page that has found nothing and asked nothing. */
export function resetAppUpdate(): void {
  generation += 1;
  lastCheck = 0;
  useAppUpdate.setState({ web: null, snoozed: null, applying: null, waiting: null });
}
