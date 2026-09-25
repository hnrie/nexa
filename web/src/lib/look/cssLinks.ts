import { create } from "zustand";
import { cssKey, lookCache } from "./cache";
import { FetchError, fetchText, type FetchFailure } from "./fetchText";

/**
 * The stylesheets behind the account's theme links, as this device has them:
 * each one's text, when it was fetched, and whether the last try worked. A
 * link is read from the device's copy first, so the app starts styled without
 * waiting for, or even reaching, the site; a copy older than a day is
 * refreshed quietly after the app has started, and Refresh fetches it now.
 */

export interface LinkState {
  status: "loading" | "ready" | "error";
  /** Bytes of the copy in use. */
  size?: number;
  fetchedAt?: number;
  /** Why the last fetch failed; the copy in use, if any, is older. */
  error?: FetchFailure;
  errorStatus?: number;
}

interface LinksState {
  /** By URL: the same file linked twice is fetched and kept once. */
  byUrl: Record<string, LinkState>;
  texts: Record<string, string>;
}

export const useCssLinks = create<LinksState>()(() => ({ byUrl: {}, texts: {} }));

const STALE_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<void>>();

function set(url: string, patch: Partial<LinkState>, text?: string): void {
  useCssLinks.setState((s) => ({
    byUrl: { ...s.byUrl, [url]: { ...(s.byUrl[url] ?? { status: "loading" }), ...patch } },
    texts: text !== undefined ? { ...s.texts, [url]: text } : s.texts,
  }));
}

/** Fetches the file now and keeps it; the copy already in use stays if this fails. */
export function refreshLink(url: string): Promise<void> {
  const running = inFlight.get(url);
  if (running) return running;
  const had = useCssLinks.getState().texts[url] !== undefined;
  if (!had) set(url, { status: "loading", error: undefined });
  const job = fetchText(url)
    .then(async (text) => {
      const fetchedAt = Date.now();
      await lookCache.put(cssKey(url), { text, fetchedAt });
      set(url, { status: "ready", size: new TextEncoder().encode(text).length, fetchedAt, error: undefined, errorStatus: undefined }, text);
    })
    .catch((err: unknown) => {
      const e = err instanceof FetchError ? err : new FetchError("network");
      set(url, { status: had ? "ready" : "error", error: e.reason, errorStatus: e.status });
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, job);
  return job;
}

/**
 * Makes the file available: from memory, from this device's copy, or from
 * the link when there is no copy. Says whether the copy is old enough to be
 * worth refreshing in the background.
 */
export async function loadLink(url: string): Promise<{ stale: boolean }> {
  if (useCssLinks.getState().texts[url] !== undefined) {
    const at = useCssLinks.getState().byUrl[url]?.fetchedAt ?? 0;
    return { stale: Date.now() - at > STALE_MS };
  }
  const cached = await lookCache.get(cssKey(url));
  if (cached) {
    set(url, { status: "ready", size: new TextEncoder().encode(cached.text).length, fetchedAt: cached.fetchedAt }, cached.text);
    return { stale: Date.now() - cached.fetchedAt > STALE_MS };
  }
  await refreshLink(url);
  return { stale: false };
}

/** Puts a file fetched elsewhere (the Add dialog) where loadLink will find it. */
export async function keepLink(url: string, text: string): Promise<void> {
  const fetchedAt = Date.now();
  await lookCache.put(cssKey(url), { text, fetchedAt });
  set(url, { status: "ready", size: new TextEncoder().encode(text).length, fetchedAt, error: undefined }, text);
}

export async function dropLink(url: string, stillUsed: boolean): Promise<void> {
  if (stillUsed) return;
  await lookCache.delete(cssKey(url));
  useCssLinks.setState((s) => {
    const byUrl = { ...s.byUrl };
    const texts = { ...s.texts };
    delete byUrl[url];
    delete texts[url];
    return { byUrl, texts };
  });
}

export function forgetLinks(): void {
  useCssLinks.setState({ byUrl: {}, texts: {} });
}
