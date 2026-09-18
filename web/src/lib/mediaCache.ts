import { channels as channelsApi } from "@/api/channels";
import { b64 } from "@/crypto/bytes";
import { decryptFile, encryptedSize } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

import { t } from "@/i18n";
interface Entry {
  url: string;
  size: number;
  last: number;
  /** How many things on screen are showing it right now. */
  refs: number;
}

const BUDGET = 200 * 1024 * 1024;

/**
 * The largest attachment that is ever opened inside the page. Playing or
 * showing a file means holding all of it, so anything bigger is only offered
 * as a download, which streams to disk instead.
 */
export const INLINE_MAX = 256 * 1024 * 1024;

/** One download several viewers may be waiting on. */
interface Job {
  promise: Promise<string>;
  /** Wired into the request; fired only once every viewer has given up. */
  ctrl: AbortController;
  waiting: number;
  done: boolean;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Job>();
let total = 0;

function evict(keep: string): void {
  if (total <= BUDGET) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].last - b[1].last);
  for (const [k, e] of entries) {
    if (total <= BUDGET) break;
    // the one just made is about to be shown, and one still on screen keeps
    // using its address for downloads and a video's later reads; revoking
    // either would break it
    if (k === keep || e.refs > 0) continue;
    URL.revokeObjectURL(e.url);
    cache.delete(k);
    total -= e.size;
  }
}

/**
 * QuickTime and M4V files are MP4 underneath, and every browser that plays
 * one plays the other, but some turn a file away by its QuickTime label alone.
 */
const PLAYABLE_AS: Record<string, string> = {
  "video/quicktime": "video/mp4",
  "video/x-m4v": "video/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
};

/**
 * Types a browser would run as a page if the address were opened on its own.
 * The sender picks the type, and an object URL lives in this app's origin.
 */
const DOCUMENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/xml", "application/xml"]);

export function playableType(type: string | undefined): string {
  if (!type) return "application/octet-stream";
  const base = type.split(";")[0]!.trim().toLowerCase();
  if (DOCUMENT_TYPES.has(base)) return "application/octet-stream";
  return PLAYABLE_AS[base] || type;
}

/** Downloads, decrypts and caches an attachment as an object URL. */
export function attachmentObjectURL(att: AttachmentMeta, signal?: AbortSignal): Promise<string> {
  const hit = cache.get(att.blob_id);
  if (hit) {
    hit.last = Date.now();
    return Promise.resolve(hit.url);
  }
  if (att.size > INLINE_MAX) return Promise.reject(new Error(t("mediaCache.thatFileIsTooLargeTo")));
  const pending = inflight.get(att.blob_id);
  if (pending) return join(pending, signal);
  const ctrl = new AbortController();
  const job: Job = { promise: undefined as unknown as Promise<string>, ctrl, waiting: 0, done: false };
  job.promise = (async () => {
    try {
      const cipher = await channelsApi.downloadAttachment(att.blob_id, ctrl.signal, encryptedSize(att.size));
      const plain = await decryptFile(cipher, b64.dec(att.key));
      const typed = new Blob([plain], { type: playableType(att.type) });
      const url = URL.createObjectURL(typed);
      cache.set(att.blob_id, { url, size: typed.size, last: Date.now(), refs: 0 });
      total += typed.size;
      evict(att.blob_id);
      return url;
    } finally {
      job.done = true;
      inflight.delete(att.blob_id);
    }
  })();
  inflight.set(att.blob_id, job);
  return join(job, signal);
}

/**
 * Adds a viewer to a download already under way.
 *
 * The request used to carry the first caller's signal, so a row scrolling out
 * of view aborted the download the lightbox opened from it was waiting on. A
 * viewer that gives up now only takes itself out; the request goes only when
 * the last one has.
 */
function join(job: Job, signal?: AbortSignal): Promise<string> {
  job.waiting += 1;
  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    signal?.removeEventListener("abort", onAbort);
    job.waiting -= 1;
    if (!job.done && job.waiting <= 0) job.ctrl.abort();
  };
  const onAbort = (): void => {
    leave();
    cancel?.(new DOMException("Aborted", "AbortError"));
  };
  const settled = job.promise.then(
    (url) => {
      leave();
      return url;
    },
    (err: unknown) => {
      leave();
      throw err;
    },
  );
  if (!signal) return settled;
  let cancel: ((err: unknown) => void) | undefined;
  const cancelled = new Promise<string>((_resolve, reject) => {
    cancel = reject;
  });
  if (signal.aborted) {
    onAbort();
    return cancelled;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([settled, cancelled]);
}

export function cachedURL(blobId: string): string | undefined {
  return cache.get(blobId)?.url;
}

/**
 * Marks a cached URL as in use by something on screen, so it is not revoked
 * under it. False when the URL is no longer the cached one and has to be
 * fetched again. Every true is paired with a release().
 */
export function acquire(blobId: string, url: string): boolean {
  const e = cache.get(blobId);
  if (!e || e.url !== url) return false;
  e.refs += 1;
  e.last = Date.now();
  return true;
}

/** Lets go of a URL taken with acquire(); once nothing holds it, it may be evicted. */
export function release(blobId: string, url: string): void {
  const e = cache.get(blobId);
  if (!e || e.url !== url || e.refs === 0) return;
  e.refs -= 1;
  e.last = Date.now();
  if (e.refs === 0) evict("");
}

export function clearMediaCache(): void {
  for (const e of cache.values()) URL.revokeObjectURL(e.url);
  cache.clear();
  total = 0;
}
