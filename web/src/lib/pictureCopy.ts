/**
 * A picture's small copy. Files are end-to-end encrypted, so the server
 * cannot shrink a picture for the chat the way it could a readable one: a
 * conversation full of phone photos downloaded every one of them whole, 4 MB
 * or so apiece, before any of it showed. Now the sender's device makes a
 * copy the size a message shows it at (picture.worker.ts), and it goes with
 * the picture, encrypted under a key of its own. The chat shows the copy;
 * opening the picture, copying it or saving it still takes the full file.
 */
import type { AttachmentMeta } from "@/crypto/message";
import type { PictureCopy, PictureReply, PictureRequest } from "./picture.worker";

export type { PictureCopy };

/** A picture's copy as an attachment of its own, to fetch and decrypt; null when it has none. */
export function copyOf(att: AttachmentMeta): AttachmentMeta | null {
  const p = att.preview;
  return p ? { blob_id: p.blob_id, key: p.key, size: p.size, type: p.type, name: att.name, w: p.w, h: p.h } : null;
}

/** The longest side of a copy: what a picture in a message needs on a sharp screen. */
export const COPY_SIDE = 1280;

/** A picture smaller than this is shown as it is: a copy would save little. */
const COPY_FROM = 256 * 1024;

/** A copy has to come out at most this share of the picture's own size to be worth sending. */
const COPY_SHARE = 0.6;

/** The largest copy sent. The server takes one of up to 2 MiB, encrypted. */
export const COPY_MAX = 1024 * 1024;

/** Kinds of picture a copy is made of: the still ones every browser here can open. */
const COPYABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp"]);

/** How long a worker may take over one picture before it is given up on. */
const WORKER_TIMEOUT_MS = 30_000;

export interface PictureLook {
  w?: number;
  h?: number;
  copy?: PictureCopy;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

/**
 * Whether a picture moves, from the start of its file: an animated PNG says
 * so before its first image data, an animated WebP in its header, and an AVIF
 * sequence in its brands. A copy is a still, so a moving picture keeps only
 * its full size. A PNG that cannot be followed that far counts as moving.
 */
export function animatedFrom(head: Uint8Array, type: string): boolean {
  if (type === "image/png") {
    for (let p = 8; p + 8 <= head.length; ) {
      const kind = ascii(head, p + 4, 4);
      if (kind === "acTL") return true;
      if (kind === "IDAT") return false;
      p += 12 + u32(head, p);
    }
    return true;
  }
  if (type === "image/webp") return ascii(head, 12, 4) === "VP8X" && ((head[20] ?? 0) & 0x02) !== 0;
  if (type === "image/avif") {
    const end = Math.min(head.length, u32(head, 0));
    for (let p = 8; p + 4 <= end; p += 4) if (ascii(head, p, 4) === "avis") return true;
  }
  return false;
}

/** Whether a picture is worth a small copy: big enough, still, and of a kind a copy can be made of. */
export async function copyWanted(file: Blob): Promise<boolean> {
  if (!COPYABLE.has(file.type) || file.size < COPY_FROM) return false;
  try {
    return !animatedFrom(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()), file.type);
  } catch {
    return false;
  }
}

/** Measures a picture here on the page, without a copy: for small pictures, and browsers that cannot draw in a worker. */
async function measure(file: Blob): Promise<PictureLook> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close();
    return out;
  } catch {
    return {};
  }
}

/**
 * How many pictures are looked at at once. Each holds its whole decoded
 * picture for a moment (48 MB for a 12 megapixel photo), so a phone takes
 * them one at a time.
 */
function lanes(): number {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const cores = nav?.hardwareConcurrency || 2;
  const memory = nav?.deviceMemory ?? 4;
  return cores >= 8 && memory >= 8 ? 3 : cores >= 4 && memory >= 4 ? 2 : 1;
}

let busy = 0;
const queue: (() => void)[] = [];

async function turn(): Promise<() => void> {
  if (busy >= lanes()) await new Promise<void>((resolve) => queue.push(resolve));
  busy += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy -= 1;
    queue.shift()?.();
  };
}

/** Asks a worker of its own, which is ended once it has answered. Null when it could not. */
function inWorker(request: PictureRequest): Promise<PictureReply | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./picture.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const end = (reply: PictureReply | null): void => {
      clearTimeout(timer);
      worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(() => end(null), WORKER_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<PictureReply>) => end(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      end(null);
    };
    worker.postMessage(request);
  });
}

/**
 * How big a picture is, with its small copy when one is worth making. Never
 * throws: a picture that cannot be looked at goes without either.
 */
export async function lookAtPicture(file: Blob): Promise<PictureLook> {
  if (!file.type.startsWith("image/")) return {};
  const wanted = await copyWanted(file);
  if (!wanted || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return measure(file);
  const done = await turn();
  try {
    const reply = await inWorker({ file, copy: true, side: COPY_SIDE });
    // the worker would not start, or went quiet: the picture is measured here instead
    if (!reply) return await measure(file);
    const out: PictureLook = {};
    if (reply.w && reply.h) {
      out.w = reply.w;
      out.h = reply.h;
    }
    const copy = reply.copy;
    if (copy && copy.blob.size <= COPY_MAX && copy.blob.size <= file.size * COPY_SHARE) out.copy = copy;
    return out;
  } finally {
    done();
  }
}
