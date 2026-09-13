import { channels as channelsApi } from "@/api/channels";
import { uploads as uploadsApi } from "@/api/uploads";
import { bufferSource } from "@/crypto/aes";
import { b64 } from "@/crypto/bytes";
import { encryptFile, encryptFrames, encryptedSize, newFileKey } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

/** Fallback until the server says what it accepts. */
export const MAX_UPLOAD = 100 * 1024 * 1024;

/**
 * What this server takes: the largest file, the most one request may carry
 * (Cloudflare turns away a body over 100 MB), and the size of each piece of
 * a file too big for that.
 */
const limits = { max: MAX_UPLOAD, single: 90 * 1024 * 1024, chunk: 32 * 1024 * 1024 };

/** Remembers the limits the server reported, so the composer can say no early. */
export function setUploadLimits(reported: { max?: number | undefined; single?: number | undefined; chunk?: number | undefined }): void {
  if (reported.max && reported.max > 0) limits.max = reported.max;
  if (reported.single && reported.single > 0) limits.single = reported.single;
  if (reported.chunk && reported.chunk > 0) limits.chunk = reported.chunk;
}

export function uploadLimit(): number {
  return limits.max;
}

/** Whether a file of `size` bytes is within the limit once encrypted, which is what the server measures. */
export function fitsUploadLimit(size: number): boolean {
  return encryptedSize(size) <= limits.max;
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

/**
 * Encrypts and uploads a staged file, returning the metadata that rides inside the message.
 *
 * A file that fits in one request is encrypted and sent whole. Anything larger
 * is encrypted a chunk at a time and sent a piece at a time as it goes, so
 * only one piece is ever held in memory however big the file is.
 */
export async function uploadStaged(channelId: string, st: Staged, onProgress: (p: number) => void): Promise<{ meta: AttachmentMeta; blob_id: string; size: number }> {
  if (!fitsUploadLimit(st.file.size)) throw new Error(`That file is over this server's ${formatSize(limits.max)} limit.`);
  const total = encryptedSize(st.file.size);
  let key: Uint8Array;
  let res: { blob_id: string; size: number };
  if (total <= limits.single) {
    const enc = await encryptFile(st.file, (done, size) => onProgress(size ? (done / size) * 0.4 : 0));
    key = enc.key;
    res = await channelsApi.uploadAttachment(channelId, enc.blob, (loaded, size) => onProgress(0.4 + (size ? loaded / size : 0) * 0.6));
  } else {
    key = newFileKey();
    res = await uploadInPieces(encryptFrames(st.file, key), total, (sent) => onProgress(sent / total));
  }
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
 * Sends a file too big for one request, a piece at a time, straight from the
 * encryptor: each piece is gathered, sent and let go before the next is made.
 *
 * The server says how much has landed, so a dropped connection costs at most
 * that one piece rather than the whole transfer. Anything already spooled is
 * thrown away if the upload is abandoned.
 */
export async function uploadInPieces(frames: AsyncIterable<Uint8Array>, total: number, onProgress: (sent: number) => void): Promise<{ blob_id: string; size: number }> {
  const session = await uploadsApi.create(total);
  const pieceSize = Math.max(1, Math.min(session.chunk_size || limits.chunk, limits.chunk));
  let sent = 0;
  let pending: BlobPart[] = [];
  let pendingLen = 0;

  const flush = async (): Promise<void> => {
    const piece = new Blob(pending);
    pending = [];
    pendingLen = 0;
    const start = sent;
    const end = start + piece.size;
    let tries = 0;
    while (sent < end) {
      try {
        const received = await uploadsApi.chunk(session.id, sent, piece.slice(sent - start), (loaded) => onProgress(sent + loaded));
        if (received <= sent || received > end) throw new Error("The server lost track of this upload.");
        sent = received;
      } catch (err) {
        tries += 1;
        if (tries >= CHUNK_TRIES) throw err;
        // ask where it got to, then carry on from there
        const state = await uploadsApi.status(session.id).catch(() => null);
        if (!state || state.received < start || state.received > end) throw err;
        sent = state.received;
        if (sent < end) await new Promise((r) => setTimeout(r, 400 * tries));
      }
      onProgress(sent);
    }
  };

  try {
    for await (const frame of frames) {
      let rest = frame;
      while (rest.length > 0) {
        const part = rest.subarray(0, pieceSize - pendingLen);
        pending.push(bufferSource(part));
        pendingLen += part.length;
        rest = rest.subarray(part.length);
        if (pendingLen === pieceSize) await flush();
      }
    }
    if (pendingLen > 0) await flush();
    if (sent !== total) throw new Error("The upload came out a different size than expected.");
    return await uploadsApi.finish(session.id);
  } catch (err) {
    await uploadsApi.cancel(session.id).catch(() => undefined);
    throw err;
  }
}
