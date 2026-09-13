import { channels as channelsApi } from "@/api/channels";
import { b64 } from "@/crypto/bytes";
import { decryptFile, encryptedSize } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

interface Entry {
  url: string;
  size: number;
  last: number;
}

const BUDGET = 200 * 1024 * 1024;

/**
 * The largest attachment that is ever opened inside the page. Playing or
 * showing a file means holding all of it, so anything bigger is only offered
 * as a download, which streams to disk instead.
 */
export const INLINE_MAX = 256 * 1024 * 1024;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();
let total = 0;

function evict(keep: string): void {
  if (total <= BUDGET) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].last - b[1].last);
  for (const [k, e] of entries) {
    if (total <= BUDGET) break;
    // the one just made is about to be shown; revoking it now would break it
    if (k === keep) continue;
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

export function playableType(type: string | undefined): string {
  return (type && PLAYABLE_AS[type.toLowerCase()]) || type || "application/octet-stream";
}

/** Downloads, decrypts and caches an attachment as an object URL. */
export function attachmentObjectURL(att: AttachmentMeta, signal?: AbortSignal): Promise<string> {
  const hit = cache.get(att.blob_id);
  if (hit) {
    hit.last = Date.now();
    return Promise.resolve(hit.url);
  }
  if (att.size > INLINE_MAX) return Promise.reject(new Error("That file is too large to open here. Download it instead."));
  const pending = inflight.get(att.blob_id);
  if (pending) return pending;
  const job = (async () => {
    try {
      const cipher = await channelsApi.downloadAttachment(att.blob_id, signal, encryptedSize(att.size));
      const plain = await decryptFile(cipher, b64.dec(att.key));
      const typed = new Blob([plain], { type: playableType(att.type) });
      const url = URL.createObjectURL(typed);
      cache.set(att.blob_id, { url, size: typed.size, last: Date.now() });
      total += typed.size;
      evict(att.blob_id);
      return url;
    } finally {
      inflight.delete(att.blob_id);
    }
  })();
  inflight.set(att.blob_id, job);
  return job;
}

export function cachedURL(blobId: string): string | undefined {
  return cache.get(blobId)?.url;
}

export function clearMediaCache(): void {
  for (const e of cache.values()) URL.revokeObjectURL(e.url);
  cache.clear();
  total = 0;
}
