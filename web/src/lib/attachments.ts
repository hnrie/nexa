import { ApiError, api, errorFrom } from "@/api/client";
import { uploads as uploadsApi } from "@/api/uploads";
import { b64 } from "@/crypto/bytes";
import { FRAME_LEN, HEADER_LEN, chunkCount, encryptChunks, encryptedSize, frameOffset, newBaseIv, newFileKey } from "@/crypto/fileChunks";
import type { AttachmentMeta } from "@/crypto/message";
import { holdReload } from "./busy";
import type { PieceReply, PieceRequest } from "./upload.worker";

import { t } from "@/i18n";
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
 * One stretch of a file to encrypt and send: chunks [first, first + count),
 * less the first `skip` bytes the server already has.
 */
export interface PieceJob {
  method: "POST" | "PATCH";
  path: string;
  headers?: Record<string, string>;
  file: Blob;
  key: Uint8Array;
  baseIv: Uint8Array;
  first: number;
  count: number;
  skip: number;
}

/** Sends a stretch, resolving with the server's answer. */
export type PieceSender = (job: PieceJob, onProgress: (loaded: number) => void) => Promise<unknown>;

/** Encrypts the stretch a job describes: exactly the bytes its request carries. */
async function bodyOf(job: PieceJob): Promise<Uint8Array<ArrayBuffer>> {
  const whole = await encryptChunks(job.file, job.key, job.baseIv, job.first, job.count);
  return job.skip > 0 ? whole.slice(job.skip) : whole;
}

/** Sends from the page itself, for a browser that cannot start the worker. */
export const sendInPage: PieceSender = async (job, onProgress) => api.upload(job.path, await bodyOf(job), { method: job.method, headers: job.headers ?? {}, onProgress });

let workers = typeof Worker !== "undefined";

/**
 * How long the page waits on a worker that has gone quiet. Longer than the
 * worker's own stall timeout, so a request that dies is reported by the worker
 * rather than guessed at here; this is only for a worker that stops answering.
 */
const WORKER_STALL_MS = 90_000;

/**
 * Encrypts a stretch here, then hands the bytes to a worker of its own that
 * sends them and is ended once they have landed, so no finished request's
 * body outlives it (see upload.worker.ts).
 */
export const sendInWorker: PieceSender = async (job, onProgress) => {
  if (!workers) return sendInPage(job, onProgress);
  const body = await bodyOf(job);
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream", ...job.headers };
  const token = api.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./upload.worker.ts", import.meta.url), { type: "module" });
    } catch {
      workers = false;
      api.upload(job.path, body, { method: job.method, headers: job.headers ?? {}, onProgress }).then(resolve, reject);
      return;
    }
    let heard = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const settled = (): void => clearTimeout(stall);
    // A worker can be taken away outright — a backgrounded tab on a phone short
    // of memory — and then neither a message nor an error ever comes. The
    // upload would show a frozen bar for good, and the reload hold it took
    // would keep a newly deployed version from ever applying to this tab.
    const watch = (): void => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        worker.terminate();
        reject(new ApiError(0, "worker", t("attachments.theUploadStoppedUnexpectedly")));
      }, WORKER_STALL_MS);
    };
    worker.onmessage = (e: MessageEvent<PieceReply>) => {
      heard = true;
      const reply = e.data;
      if (reply.type === "progress") {
        watch();
        onProgress(reply.loaded);
        return;
      }
      settled();
      worker.terminate();
      if (reply.type === "failed") {
        reject(new ApiError(0, "network", t("attachments.theUploadCouldNotReachThe")));
        return;
      }
      if (reply.status >= 200 && reply.status < 300) {
        try {
          resolve(reply.text ? JSON.parse(reply.text) : undefined);
        } catch {
          reject(new ApiError(reply.status, "bad_response", t("attachments.theServerSAnswerCouldNot")));
        }
        return;
      }
      if (reply.status === 401) api.onUnauthorized?.();
      reject(errorFrom(reply.status, reply.text, reply.retryAfter));
    };
    worker.onerror = (e) => {
      settled();
      worker.terminate();
      if (heard) {
        reject(new ApiError(0, "worker", t("attachments.theUploadStoppedUnexpectedly")));
        return;
      }
      // It never got going (an older browser, or its script would not load).
      // The body went to it, so make the stretch again and send it from here.
      e.preventDefault();
      workers = false;
      sendInPage(job, onProgress).then(resolve, reject);
    };
    const request: PieceRequest = { url: new URL(api.url(job.path), location.href).href, method: job.method, headers, body: body.buffer };
    watch();
    worker.postMessage(request, [body.buffer]);
  });
};

/**
 * Encrypts and uploads a staged file, returning the metadata that rides inside the message.
 *
 * A file that fits in one request goes up as one request. Anything larger
 * goes up a stretch of chunks at a time, each stretch encrypted only as it is
 * sent. Either way the work happens in a worker that is ended afterwards, so
 * memory holds one request's worth at most, however big the file is.
 */
export async function uploadStaged(channelId: string, st: Staged, onProgress: (p: number) => void, send: PieceSender = sendInWorker): Promise<{ meta: AttachmentMeta; blob_id: string; size: number }> {
  if (!fitsUploadLimit(st.file.size)) throw new Error(t("attachments.overServerLimit", { limit: formatSize(limits.max) }));
  const total = encryptedSize(st.file.size);
  const key = newFileKey();
  const baseIv = newBaseIv();
  let res: { blob_id: string; size: number };
  // a new version of the app waits for the upload rather than reloading over it
  const release = holdReload();
  try {
    if (total <= limits.single) {
      const job: PieceJob = { method: "POST", path: `/channels/${channelId}/attachments`, file: st.file, key, baseIv, first: 0, count: chunkCount(st.file.size), skip: 0 };
      res = (await send(job, (loaded) => onProgress(loaded / total))) as { blob_id: string; size: number };
    } else {
      res = await uploadInPieces(st.file, key, baseIv, (sent) => onProgress(sent / total), send);
    }
  } finally {
    release();
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

/** How many times one piece is retried, while the server can be reached, before the upload gives up. */
const CHUNK_TRIES = 4;

/** How long an upload waits for a lost connection to come back without getting any further. */
const STALL_MS = 5 * 60_000;

/** Waits `ms`, or less if the device was offline and comes back online. */
function connectionBack(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const offline = typeof window !== "undefined" && navigator.onLine === false;
    const done = (): void => {
      clearTimeout(timer);
      if (offline) window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (offline) window.addEventListener("online", done);
  });
}

/**
 * How much of an upload the server holds. When it cannot be asked (the phone
 * is between networks, the server is restarting) this keeps asking, further
 * apart each time, until `deadline`; null means it never answered.
 * `waited` says the connection was down for a while.
 */
async function landedSoFar(id: string, deadline: number): Promise<{ received: number; waited: boolean } | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const state = await uploadsApi.status(id);
      return { received: state.received, waited: attempt > 0 };
    } catch (err) {
      // gone, or not ours any more: no amount of waiting brings it back
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) return null;
      if (Date.now() >= deadline) return null;
      await connectionBack(Math.min(30_000, 1000 * 2 ** attempt, Math.max(0, deadline - Date.now())));
    }
  }
}

/**
 * Turns the landed pieces into a file. Finishing twice gives back the same
 * file, so a reply lost to a dropped connection or a server hiccup is asked for
 * again rather than costing the whole upload; a refusal is final.
 */
async function finishUpload(id: string): Promise<{ blob_id: string; size: number }> {
  for (let tries = 1; ; tries++) {
    try {
      return await uploadsApi.finish(id);
    } catch (err) {
      const refused = err instanceof ApiError && err.status > 0 && err.status < 500;
      if (refused || tries >= CHUNK_TRIES) throw err;
      await new Promise((r) => setTimeout(r, 400 * tries));
    }
  }
}

/**
 * Sends a file too big for one request, a piece at a time. Each piece is a
 * whole number of chunks, so it can be encrypted on its own when its turn
 * comes, and again identically if it has to be sent twice.
 *
 * The server says how much has landed, so a dropped connection costs at most
 * that one piece rather than the whole transfer. Anything already spooled is
 * thrown away if the upload is abandoned.
 */
export async function uploadInPieces(file: Blob, key: Uint8Array, baseIv: Uint8Array, onProgress: (sent: number) => void, send: PieceSender = sendInWorker): Promise<{ blob_id: string; size: number }> {
  const total = encryptedSize(file.size);
  const chunks = chunkCount(file.size);
  const session = await uploadsApi.create(total);
  const limit = Math.min(session.chunk_size || limits.chunk, limits.chunk);
  const perPiece = Math.max(1, Math.floor((limit - HEADER_LEN) / FRAME_LEN));
  let sent = 0;
  /** When the upload last got further; it gives up after STALL_MS without. */
  let movedAt = Date.now();
  try {
    for (let first = 0; first < chunks; first += perPiece) {
      const count = Math.min(perPiece, chunks - first);
      const start = first === 0 ? 0 : frameOffset(first);
      const end = Math.min(total, frameOffset(first + count));
      if (sent !== start) throw new Error(t("attachments.theUploadLostItsPlace"));
      let tries = 0;
      while (sent < end) {
        try {
          const job: PieceJob = { method: "PATCH", path: `/uploads/${session.id}`, headers: { "Upload-Offset": String(sent) }, file, key, baseIv, first, count, skip: sent - start };
          const from = sent;
          const reply = (await send(job, (loaded) => onProgress(from + loaded))) as { received?: number } | undefined;
          const received = reply?.received ?? -1;
          if (received <= sent || received > end) throw new Error(t("attachments.theServerLostTrackOfThis"));
          sent = received;
          movedAt = Date.now();
        } catch (err) {
          // ask where it got to, waiting for the connection if it dropped, then carry on from there
          const landed = await landedSoFar(session.id, movedAt + STALL_MS);
          if (!landed || landed.received < start || landed.received > end) throw err;
          if (landed.received > sent) {
            tries = 0;
            movedAt = Date.now();
          } else if (!landed.waited) {
            // the server was there all along and the piece still did not land
            tries += 1;
          }
          if (tries >= CHUNK_TRIES || Date.now() - movedAt > STALL_MS) throw err;
          sent = landed.received;
          if (sent < end) await new Promise((r) => setTimeout(r, 400 * tries));
        }
        onProgress(sent);
      }
    }
    if (sent !== total) throw new Error(t("attachments.theUploadCameOutADifferentSize"));
    return await finishUpload(session.id);
  } catch (err) {
    await uploadsApi.cancel(session.id).catch(() => undefined);
    throw err;
  }
}
