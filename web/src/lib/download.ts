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
import { noDesktopBuild } from "@/lib/platform";

import { pickSaveFile, saveBlob, type SaveFileHandle } from "./saveFile";

import { t } from "@/i18n";
/** Above this, a download streams through the service worker when it can. */
export const STREAM_ABOVE = 64 * 1024 * 1024;

const MB = 1024 * 1024;

/**
 * Without the worker, the most that will be decrypted in the page to save:
 * the encrypted copy and the plain one are both in memory at once. Chromium
 * moves large Blobs to disk, which a gigabyte was sized for; WebKit keeps them
 * in memory, and iOS ends a page well before two. So it follows the device:
 * its memory where the browser says, a phone's or tablet's worth otherwise.
 */
export function inPageMax(): number {
  const memory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (typeof memory === "number" && memory > 0) return Math.min(1024, Math.max(128, memory * 128)) * MB;
  return noDesktopBuild() ? 256 * MB : 1024 * MB;
}

/**
 * An iOS home-screen app has no download manager for the worker's stream to
 * land in: the browser never comes for the file, and the save would wait out
 * the start timeout for nothing.
 */
function homeScreenIOS(): boolean {
  return typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

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

/** The service worker that streams downloads and videos, once it is running. */
export async function downloadWorker(): Promise<ServiceWorker | null> {
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

/** Whether a download is streaming to disk right now. */
export function downloading(): boolean {
  return streaming > 0;
}

export function hex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface WorkerMessage {
  type?: string;
  done?: number;
  message?: string;
  body?: ReadableStream<Uint8Array>;
}

/**
 * Has the service worker stream the file to disk. "unavailable" means nothing
 * was saved and the page should do it itself: there is no worker, it is an
 * older one that knows nothing of downloads, or the browser never came for
 * the file.
 */
async function streamThroughWorker(att: AttachmentMeta, onProgress?: DownloadProgress, handle?: SaveFileHandle): Promise<"done" | "unavailable"> {
  const worker = await downloadWorker();
  if (!worker || typeof MessageChannel === "undefined" || typeof document === "undefined") return "unavailable";
  const id = hex(randomBytes(16));
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    let frame: HTMLIFrameElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holding = false;
    let fileReceived = false;
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
        case "file": {
          const body = msg.body;
          if (!handle || !body) { unavailable(); return; }
          fileReceived = true;
          if (!holding) hold();
          holding = true;
          clearTimeout(timer);
          void (async () => {
            try {
              const out = await handle.createWritable();
              await body.pipeTo(out);
            } catch (err) {
              if (!body.locked) await body.cancel().catch(() => undefined);
              throw err;
            }
          })().then(() => {
            onProgress?.(att.size, att.size);
            end();
            resolve("done");
          }, (err: unknown) => {
            worker.postMessage({ type: "download-forget", id });
            end();
            reject(err);
          });
          return;
        }
        case "file-unavailable":
          unavailable();
          return;
        case "ready":
          // An older worker cannot transfer a stream into a chosen file yet.
          if (handle) { unavailable(); return; }
          frame = document.createElement("iframe");
          frame.hidden = true;
          frame.src = DOWNLOAD_PATH + id;
          document.body.appendChild(frame);
          wait(START_TIMEOUT, unavailable);
          return;
        case "started":
          if (!holding) hold();
          holding = true;
          if (!handle) wait(QUIET_TIMEOUT, quiet);
          return;
        case "progress":
          onProgress?.(msg.done ?? 0, att.size);
          if (!handle) wait(QUIET_TIMEOUT, quiet);
          return;
        case "done":
          if (handle) return; // The last write and close must finish first.
          onProgress?.(att.size, att.size);
          end();
          resolve("done");
          return;
        case "cancelled":
          if (handle) return; // pipeTo reports cancellation and disk failures.
          end();
          resolve("done");
          return;
        case "error":
          if (handle && fileReceived) return; // The transferred stream rejects and aborts the pipe.
          end();
          reject(new Error(msg.message || t("download.theDownloadFailed")));
          return;
      }
    };
    wait(READY_TIMEOUT, unavailable);
    worker.postMessage(
      {
        type: "download",
        toFile: !!handle,
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

/** The share of an in-page save's progress bar that the download itself fills; decrypting fills the rest. */
const FETCH_SHARE = 0.9;

async function saveInPage(att: AttachmentMeta, onProgress?: DownloadProgress, handle?: SaveFileHandle): Promise<void> {
  // a webhook's file came unencrypted and downloads as it is
  const expected = att.plain ? att.size : encryptedSize(att.size);
  // the body arrives in many small pieces, so only a new whole percent is passed on
  let shown = -1;
  const fetched = onProgress
    ? (got: number) => {
        const percent = Math.floor((got / expected) * 100);
        if (percent === shown) return;
        shown = percent;
        onProgress(Math.round((got / expected) * FETCH_SHARE * att.size), att.size);
      }
    : undefined;
  const cipher = await channelsApi.downloadAttachment(att.blob_id, undefined, expected, fetched);
  const decrypted = onProgress
    ? (done: number, total: number) => onProgress(Math.round((FETCH_SHARE + (total > 0 ? done / total : 1) * (1 - FETCH_SHARE)) * att.size), att.size)
    : undefined;
  let plain: Blob;
  try {
    plain = att.plain ? cipher : await decryptFile(cipher, b64.dec(att.key), decrypted, att.size);
  } catch (err) {
    if (err instanceof DecryptError) throw new Error(t("download.thisFileCouldNotBeDecrypted"));
    throw err;
  }
  await saveBlob(new Blob([plain], { type: att.type || "application/octet-stream" }), att.name || "download", handle);
}

/** Decrypts an attachment and saves it at the chosen location where supported. */
export async function saveAttachment(att: AttachmentMeta, onProgress?: DownloadProgress): Promise<void> {
  const handle = await pickSaveFile(att.name || "download");
  if (handle === null) return;
  // the streaming worker decrypts as it goes; a webhook's file has nothing to decrypt
  if (att.size > STREAM_ABOVE && !att.plain) {
    if (!homeScreenIOS() && (await streamThroughWorker(att, onProgress, handle)) === "done") return;
    // said before anything is fetched: a phone decrypting more than it can
    // hold does not fail, it reloads the app with nothing saved
    if (att.size > inPageMax()) {
      // a browser that can stream just has not started its worker yet; a reload fixes that
      const later = !homeScreenIOS() && typeof navigator !== "undefined" && !!navigator.serviceWorker;
      throw new Error(later ? t("download.thisFileIsTooLargeTo") : t("download.tooLargeForThisDevice"));
    }
  }
  await saveInPage(att, onProgress, handle);
}
