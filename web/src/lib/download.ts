/**
 * Saving an attachment to disk.
 *
 * A small file is decrypted in the page and handed over as a Blob. A large one
 * is handed to the download service worker, which fetches and decrypts it a
 * chunk at a time while the browser's own download manager writes it out, so
 * no copy of the whole file ever sits in memory, however big it is.
 */

import { attachmentUrl, channels as channelsApi } from "@/api/channels";
import { api } from "@/api/client";
import { b64, randomBytes } from "@/crypto/bytes";
import { decryptFile, encryptedSize } from "@/crypto/file";
import { DecryptError } from "@/crypto/keys";
import type { AttachmentMeta } from "@/crypto/message";

/** Above this, a download streams through the service worker when it can. */
export const STREAM_ABOVE = 64 * 1024 * 1024;

/** Without the worker, the most that will be decrypted in the page to save. */
const IN_PAGE_MAX = 1024 * 1024 * 1024;

/** The address the download worker answers on; download-sw.ts has the other end. */
const DOWNLOAD_PATH = "/__download/";

/** How long the worker has to take the job, then for the browser to come for the file. */
const READY_TIMEOUT = 5_000;
const START_TIMEOUT = 15_000;
/** A download that has gone quiet this long (paused, most likely) stops being tracked here. */
const QUIET_TIMEOUT = 10 * 60_000;
/** How often the worker is nudged, so the browser does not stop it partway through a file. */
const KEEPALIVE_MS = 10_000;

export type DownloadProgress = (done: number, total: number) => void;

let streaming = 0;
let pinger: ReturnType<typeof setInterval> | null = null;
const waiters: Array<() => void> = [];

/** The service worker that streams downloads, once it is running. */
async function downloadWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  const reg = await navigator.serviceWorker.getRegistration(DOWNLOAD_PATH).catch(() => undefined);
  if (!reg?.scope.endsWith(DOWNLOAD_PATH)) return null;
  return reg.active;
}

function hold(): void {
  streaming += 1;
  pinger ??= setInterval(() => void downloadWorker().then((w) => w?.postMessage({ type: "keepalive" })), KEEPALIVE_MS);
}

function release(): void {
  streaming = Math.max(0, streaming - 1);
  if (streaming > 0) return;
  if (pinger) clearInterval(pinger);
  pinger = null;
  for (const wake of waiters.splice(0)) wake();
}

/** Resolves once nothing is streaming, so reloading the page never cuts a download off. */
export function downloadsSettled(): Promise<void> {
  return streaming === 0 ? Promise.resolve() : new Promise((r) => waiters.push(r));
}

function hex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface WorkerMessage {
  type?: string;
  done?: number;
  message?: string;
}

/**
 * Has the service worker stream the file to disk. "unavailable" means nothing
 * was saved and the page should do it itself: there is no worker, it is an
 * older one that knows nothing of downloads, or the browser never came for
 * the file.
 */
async function streamThroughWorker(att: AttachmentMeta, onProgress?: DownloadProgress): Promise<"done" | "unavailable"> {
  const worker = await downloadWorker();
  if (!worker || typeof MessageChannel === "undefined" || typeof document === "undefined") return "unavailable";
  const id = hex(randomBytes(16));
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    let frame: HTMLIFrameElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holding = false;
    const wait = (ms: number, then: () => void): void => {
      clearTimeout(timer);
      timer = setTimeout(then, ms);
    };
    const end = (): void => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      frame?.remove();
      frame = null;
      if (holding) release();
      holding = false;
    };
    const unavailable = (): void => {
      // and make sure a late start cannot save a second copy
      worker.postMessage({ type: "download-forget", id });
      end();
      resolve("unavailable");
    };
    const quiet = (): void => {
      end();
      resolve("done");
    };
    channel.port1.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data ?? {};
      switch (msg.type) {
        case "ready":
          frame = document.createElement("iframe");
          frame.hidden = true;
          frame.src = DOWNLOAD_PATH + id;
          document.body.appendChild(frame);
          wait(START_TIMEOUT, unavailable);
          return;
        case "started":
          if (!holding) hold();
          holding = true;
          wait(QUIET_TIMEOUT, quiet);
          return;
        case "progress":
          onProgress?.(msg.done ?? 0, att.size);
          wait(QUIET_TIMEOUT, quiet);
          return;
        case "done":
          onProgress?.(att.size, att.size);
          end();
          resolve("done");
          return;
        case "cancelled":
          end();
          resolve("done");
          return;
        case "error":
          end();
          reject(new Error(msg.message || "The download failed."));
          return;
      }
    };
    wait(READY_TIMEOUT, unavailable);
    worker.postMessage(
      {
        type: "download",
        id,
        url: new URL(attachmentUrl(att.blob_id), location.href).href,
        token: api.getToken(),
        key: b64.dec(att.key),
        name: att.name,
        size: att.size,
      },
      [channel.port2],
    );
  });
}

async function saveInPage(att: AttachmentMeta, onProgress?: DownloadProgress): Promise<void> {
  const cipher = await channelsApi.downloadAttachment(att.blob_id, undefined, encryptedSize(att.size));
  let plain: Blob;
  try {
    plain = await decryptFile(cipher, b64.dec(att.key), onProgress);
  } catch (err) {
    if (err instanceof DecryptError) throw new Error("This file could not be decrypted.");
    throw err;
  }
  const url = URL.createObjectURL(new Blob([plain], { type: att.type || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = att.name || "download";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // the browser has its own hold on the file by the time this runs out
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Decrypts an attachment and saves it where the browser keeps downloads. */
export async function saveAttachment(att: AttachmentMeta, onProgress?: DownloadProgress): Promise<void> {
  if (att.size > STREAM_ABOVE) {
    if ((await streamThroughWorker(att, onProgress)) === "done") return;
    if (att.size > IN_PAGE_MAX) throw new Error("This file is too large to save from this tab right now. Reload the page and try again.");
  }
  await saveInPage(att, onProgress);
}
