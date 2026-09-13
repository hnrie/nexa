import { channels as channelsApi } from "@/api/channels";
import { uploads as uploadsApi } from "@/api/uploads";
import { b64 } from "@/crypto/bytes";
import { encryptFile } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

/** Fallback until the server says what it accepts. */
export const MAX_UPLOAD = 100 * 1024 * 1024;

/** What this server takes, and how much fits in one request. */
let limits = { max: MAX_UPLOAD, chunk: 32 * 1024 * 1024 };

/** Remembers the limits the server reported, so the composer can say no early. */
export function setUploadLimits(max: number, chunk: number): void {
  if (max > 0) limits.max = max;
  if (chunk > 0) limits.chunk = chunk;
}

export function uploadLimit(): number {
  return limits.max;
}

export interface Staged {
  id: string;
  file: File;
  name: string;
  spoiler: boolean;
  preview: string | null;
  progress: number;
  error: string | null;
}

let seq = 0;
export function stage(file: File): Staged {
  seq += 1;
  const preview = file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null;
  return { id: `f${seq}`, file, name: file.name, spoiler: false, preview, progress: 0, error: null };
}

async function imageDims(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/** Encrypts and uploads a staged file, returning the metadata that rides inside the message. */
export async function uploadStaged(channelId: string, st: Staged, onProgress: (p: number) => void): Promise<{ meta: AttachmentMeta; blob_id: string; size: number }> {
  if (st.file.size > limits.max) throw new Error(`That file is over this server's ${formatSize(limits.max)} limit.`);
  const { key, blob } = await encryptFile(st.file, (done, total) => onProgress(total ? (done / total) * 0.4 : 0));
  const send = (loaded: number, total: number) => onProgress(0.4 + (total ? loaded / total : 0) * 0.6);
  const res = blob.size > limits.chunk ? await uploadInPieces(blob, send) : await channelsApi.uploadAttachment(channelId, blob, send);
  const dims = await imageDims(st.file);
  const meta: AttachmentMeta = { blob_id: res.blob_id, name: st.name || st.file.name, type: st.file.type || "application/octet-stream", size: st.file.size, key: b64.enc(key) };
  if (dims) {
    meta.w = dims.w;
    meta.h = dims.h;
  }
  if (st.spoiler) meta.spoiler = true;
  return { meta, blob_id: res.blob_id, size: res.size };
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${Math.round(gb * 10) / 10} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** How many times one piece is retried before the upload gives up. */
const CHUNK_TRIES = 4;

/**
 * Sends a file that is too big for one request, a piece at a time.
 *
 * The server says where it expects the next piece to start, so a dropped
 * connection costs that piece rather than the whole transfer. Anything already
 * spooled is thrown away if the upload is abandoned.
 */
async function uploadInPieces(blob: Blob, onProgress: (loaded: number, total: number) => void): Promise<{ blob_id: string; size: number }> {
  const session = await uploadsApi.create(blob.size);
  const chunk = Math.max(1, Math.min(session.chunk_size || limits.chunk, limits.chunk));
  let sent = session.received;
  try {
    while (sent < blob.size) {
      const end = Math.min(sent + chunk, blob.size);
      const piece = blob.slice(sent, end);
      let tries = 0;
      for (;;) {
        try {
          sent = await uploadsApi.chunk(session.id, sent, piece, (loaded) => onProgress(sent + loaded, blob.size));
          break;
        } catch (err) {
          tries += 1;
          if (tries >= CHUNK_TRIES) throw err;
          // ask where it got to, then carry on from there
          const state = await uploadsApi.status(session.id).catch(() => null);
          if (!state) throw err;
          sent = state.received;
          if (sent >= blob.size) break;
          await new Promise((r) => setTimeout(r, 400 * tries));
        }
      }
      onProgress(sent, blob.size);
    }
    return await uploadsApi.finish(session.id);
  } catch (err) {
    await uploadsApi.cancel(session.id).catch(() => undefined);
    throw err;
  }
}
