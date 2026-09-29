/**
 * How the app walks message history without being a nuisance to the server
 * or the tab: the search index's crawl and the data export both page through
 * whole conversations, and both go at this pace.
 */
import { ApiError } from "@/api/client";
import type { DecryptedMessage } from "@/lib/decrypt";

/** The most messages one request may ask for; the server refuses more than 100. */
export const PAGE = 100;

/**
 * The shortest gap between two history requests while someone is waiting on
 * them (a search over history the index has not reached yet, an export).
 *
 * The history endpoint sits behind the generic per-user limiter: 600 requests
 * a minute, burst 300. A page every 200 ms is 300 a minute, half the budget,
 * so a walk never starves the rest of the app and never trips the limiter on
 * its own. At a hundred messages a page that is still five hundred messages a
 * second, which is faster than the decryption behind it anyway.
 */
export const REQUEST_GAP_MS = 200;

/**
 * The gap while nobody is waiting: the index filling itself in the background.
 * 120 requests a minute, a fifth of the budget, twelve thousand messages a
 * minute; and slower again while the app is out of sight.
 */
export const BACKGROUND_GAP_MS = 500;
export const HIDDEN_GAP_MS = 1_500;

/** Tries a page gets before its conversation is given up on for now. */
export const MAX_RETRIES = 4;

/** The first wait after a refusal with no Retry-After; it doubles from there. */
const BACKOFF_MS = 1_000;

/** However long a server asks us to wait, we stop waiting at this. */
const MAX_BACKOFF_MS = 30_000;

/** A refusal worth waiting out, as opposed to one that will never succeed. */
export function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  // 0 is the client's own stand-in for a timeout or a dead network.
  return err.status === 429 || err.status === 0 || err.status >= 500;
}

/** How long to wait before asking for a page again; the server's own answer wins. */
export function backoffFor(err: unknown, attempt: number): number {
  const asked = err instanceof ApiError && err.retryAfter !== undefined ? err.retryAfter * 1000 : 0;
  const grown = BACKOFF_MS * 2 ** attempt;
  return Math.min(Math.max(asked, grown), MAX_BACKOFF_MS);
}

/**
 * Whether a page says the walk has reached the edge of what its reader may
 * read. Someone added to a server last month can decrypt last month's history
 * and nothing before the grant, and paging through the years before it would
 * cost thousands of requests to decrypt nothing.
 */
export function pageIsAllLocked(page: DecryptedMessage[]): boolean {
  return page.length > 0 && page.every((m) => m.decryptError === "no_key");
}

/** One past an id, so a page asked for `before` it still includes it. */
export function justAfter(id: string): string {
  try {
    return (BigInt(id) + 1n).toString();
  } catch {
    return id;
  }
}

/**
 * Hands the event loop back.
 *
 * `scheduler.yield()` resumes ahead of the tasks queued behind it, so a walk
 * does not lose its place to every pending timer; where it is missing a zero
 * timeout is the same idea with a worse guarantee.
 */
export function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === "function") return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits, or stops waiting the moment the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
