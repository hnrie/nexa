import { channels as channelsApi } from "@/api/channels";
import { b64 } from "@/crypto/bytes";
import { decryptFile } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

interface Entry {
  url: string;
  size: number;
  last: number;
}

const BUDGET = 200 * 1024 * 1024;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();
let total = 0;

function evict(): void {
  if (total <= BUDGET) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].last - b[1].last);
  for (const [k, e] of entries) {
    if (total <= BUDGET) break;
    URL.revokeObjectURL(e.url);
    cache.delete(k);
    total -= e.size;
  }
}

/** Downloads, decrypts and caches an attachment as an object URL. */
export function attachmentObjectURL(att: AttachmentMeta, signal?: AbortSignal): Promise<string> {
  const hit = cache.get(att.blob_id);
  if (hit) {
    hit.last = Date.now();
    return Promise.resolve(hit.url);
  }
  const pending = inflight.get(att.blob_id);
  if (pending) return pending;
  const job = (async () => {
    try {
      const cipher = await channelsApi.downloadAttachment(att.blob_id, signal);
      const plain = await decryptFile(new Blob([cipher]), b64.dec(att.key));
      const typed = new Blob([plain], { type: att.type || "application/octet-stream" });
      const url = URL.createObjectURL(typed);
      cache.set(att.blob_id, { url, size: typed.size, last: Date.now() });
      total += typed.size;
      evict();
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
