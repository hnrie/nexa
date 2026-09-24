import { useSyncExternalStore } from "react";
import { api } from "@/api/client";

/**
 * Remote pictures, GIFs and videos, made safe and able to load.
 *
 * Every address a link preview loads is one this server signed for its media
 * proxy, so opening a chat never tells another site who is reading. Those
 * signatures carry a deadline of a day (internal/api/proxy_handlers.go), and a
 * preview is stored inside its message's end-to-end encryption, where the
 * server cannot renew it: a day after a message was sent its pictures stopped
 * loading, everything sent before deadlines existed stopped at once, and every
 * favourite GIF was offered for deletion as dead. A stale link is signed again
 * here, a batch at a time, before anything asks for it.
 *
 * Anything else remote is not loaded at all. A preview from before icons and
 * inline videos were proxied holds the site's own addresses for them, and
 * loading one would hand that site the reader's address after all.
 */

const PROXY_PREFIX = "/media/proxy/";
/** A link this close to its deadline is signed again rather than risked. */
const MARGIN_MS = 5 * 60 * 1000;
/** Links gathered for one request, and how long to wait for more to join it. */
const BATCH = 100;
const GATHER_MS = 30;
/** After a request that did not get through, how long before its links are asked for again. */
const RETRY_MS = 30 * 1000;

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost";
}

/** The path of a link to this server's proxy, or null for anything else. */
function proxyPath(url: string): string | null {
  if (url.startsWith(PROXY_PREFIX)) return url;
  try {
    const u = new URL(url);
    if (u.origin === origin() && u.pathname.startsWith(PROXY_PREFIX)) return u.pathname;
  } catch {
    // not a URL at all
  }
  return null;
}

export function isProxied(url: string): boolean {
  return proxyPath(url) !== null;
}

/** When a proxy link stops working, in milliseconds; null for one signed before links had deadlines. */
export function proxyDeadline(url: string): number | null {
  const path = proxyPath(url);
  if (!path) return null;
  const sig = path.slice(PROXY_PREFIX.length).split("/")[0] ?? "";
  const m = /^(\d{9,12})-/.exec(sig);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * What a media link points at, the same however often it is signed: every
 * signing has a new deadline and so a new address, and comparing addresses
 * said a favourite GIF was not one.
 */
export function mediaKey(url: string): string {
  const path = proxyPath(url);
  if (!path) return url;
  return path.slice(PROXY_PREFIX.length).split("/")[1] ?? url;
}

/** Whether a link can be loaded as it is: this server's own media, a fresh proxy link, or local data. */
function usableAsIs(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (isProxied(url)) {
    const deadline = proxyDeadline(url);
    return deadline !== null && deadline - Date.now() > MARGIN_MS;
  }
  // Backslashes, whitespace and control characters are how a path that
  // starts with "/" gets a browser to fetch from somewhere else — a backslash
  // or a tab where the second slash of "//host" would be resolves to another
  // origin. None belongs in a media link, so a link with any of them is not
  // loaded as it is.
  if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return false;
  // resolved the way the browser will resolve it, then compared by origin
  try {
    const base = typeof location !== "undefined" ? location.href : origin() + "/";
    return new URL(url, base).origin === origin();
  } catch {
    return false;
  }
}

// --- signing again ------------------------------------------------------------

const renewed = new Map<string, string>();
/** Links the server would not sign: not its own, and that does not change. */
const refused = new Set<string>();
/** Links whose request did not get through, and when; they wait, then are asked for again. */
const failed = new Map<string, number>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const queued = new Set<string>();
const asking = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function flush(): Promise<void> {
  timer = null;
  const batch = [...queued].slice(0, BATCH);
  for (const url of batch) {
    queued.delete(url);
    asking.add(url);
  }
  if (queued.size) timer = setTimeout(() => void flush(), GATHER_MS);
  try {
    const res = await api.request<{ urls?: Record<string, string> }>("POST", "/proxy/refresh", { urls: batch });
    const urls = res?.urls ?? {};
    for (const url of batch) {
      const fresh = urls[url];
      failed.delete(url);
      if (typeof fresh === "string" && isProxied(fresh)) renewed.set(url, fresh);
      else refused.add(url);
    }
  } catch {
    // Offline or rate limited: the links wait, still loading, and are asked for
    // again. Refusing them would tell the GIF picker every favourite was gone.
    const now = Date.now();
    for (const url of batch) failed.set(url, now);
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        changed();
      }, RETRY_MS);
    }
  } finally {
    for (const url of batch) asking.delete(url);
    changed();
  }
}

function ask(url: string): void {
  if (queued.has(url) || asking.has(url)) return;
  queued.add(url);
  if (!timer) timer = setTimeout(() => void flush(), GATHER_MS);
}

/**
 * What to load for a media link just now: the address itself, a newly signed
 * one, `undefined` while one is being asked for, or `null` for something that
 * must not be loaded from here.
 */
export function mediaSrc(url: string | null | undefined): string | null | undefined {
  if (!url) return null;
  if (usableAsIs(url)) return url;
  if (!isProxied(url)) return null;
  const fresh = renewed.get(url);
  if (fresh && usableAsIs(fresh)) return fresh;
  if (refused.has(url)) return null;
  const at = failed.get(url);
  if (at !== undefined && Date.now() - at < RETRY_MS) return undefined;
  ask(url);
  return undefined;
}

/** [mediaSrc], and a re-render once a link that was being signed again comes back. */
export function useMediaSrc(url: string | null | undefined): string | null | undefined {
  useSyncExternalStore(subscribe, () => version, () => version);
  return mediaSrc(url);
}

/** For a list of links: re-renders whenever any of them comes back signed again. */
export function useMediaLinks(): typeof mediaSrc {
  useSyncExternalStore(subscribe, () => version, () => version);
  return mediaSrc;
}

/**
 * A picture that shows nothing, for a tile whose link is still being signed
 * again. An empty `src` fires an error, which the GIF picker reads as a
 * favourite that is gone for good.
 */
export const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** For tests: forgets every link signed again and every one refused. */
export function resetMediaLinks(): void {
  renewed.clear();
  refused.clear();
  failed.clear();
  queued.clear();
  asking.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  changed();
}
