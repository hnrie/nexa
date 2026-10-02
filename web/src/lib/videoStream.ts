/**
 * Playing an encrypted video while it downloads.
 *
 * The download worker (download-sw.ts) answers a video's range requests by
 * fetching and decrypting only the chunks they cover (crypto/streamRange.ts):
 * a video plays as soon as its first 4 MB are in, and a seek fetches only
 * where it lands. A worker is shown only the requests of pages in its scope,
 * and no page of the app is in this one's (sw.ts says why), so the video sits
 * in a frame the worker writes itself, /__download/play/<id>, and the app's
 * own player works it from outside the frame (VideoPlayer's `frame`).
 *
 * A browser stops an idle worker whenever it likes, and the stream goes with
 * it, so the page says the stream again every little while, which also keeps
 * the worker going, and at once when the worker asks for one it has lost.
 */
import { attachmentUrl } from "@/api/channels";
import { api } from "@/api/client";
import { b64, randomBytes } from "@/crypto/bytes";
import type { AttachmentMeta } from "@/crypto/message";
import { downloadWorker, hex } from "./download";

const PLAY_PATH = "/__download/play/";
/** How long the worker has to take a stream. One from before streaming never answers, and the video downloads whole instead. */
const READY_TIMEOUT = 3_000;
/** How often an open stream is said again: well inside the worker's two minutes, and often enough to keep it running. */
const REFRESH_MS = 15_000;

export interface VideoStream {
  /** The frame the video plays in. */
  frame: string;
  /**
   * Whether the stream itself failed (the file could not be fetched or
   * decrypted), rather than the browser not playing what it was given.
   */
  failed(): boolean;
  close(): void;
}

/** The streams open on this page, each with how to say it again. */
const open = new Map<string, () => void>();
/** Those the worker has said it could not serve. */
const failed = new Set<string>();
let listening = false;

function listen(): void {
  if (listening || typeof navigator === "undefined" || !navigator.serviceWorker) return;
  listening = true;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent<unknown>) => {
    const msg = e.data as { type?: unknown; id?: unknown } | null;
    if (typeof msg?.id !== "string" || !open.has(msg.id)) return;
    if (msg.type === "stream-wanted") open.get(msg.id)?.();
    if (msg.type === "stream-failed") failed.add(msg.id);
  });
  navigator.serviceWorker.startMessages();
}

/** Turns streaming "on" in Safari to try it there, or "off" everywhere. */
const SWITCH_KEY = "ec:streamVideos";

function switched(): string | null {
  try {
    return localStorage.getItem(SWITCH_KEY);
  } catch {
    return null;
  }
}

/**
 * Safari, and every browser on an iPhone or iPad, all WebKit underneath.
 * Streaming has not been tried in Safari's own media stack, which could not
 * be run where this was built; WebKit's media stack on Linux, a different
 * one, loses its place after a seek through the worker, though every answer
 * the worker gave it was whole. So there, until it has been tried, a video
 * downloads whole first, as it always did.
 */
function webkitEngine(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // an iPad asking for the desktop site says it is a Mac, one with a touch screen
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua);
}

/** Whether videos could stream here at all; whether one does is known once the worker has answered. */
export function canStream(): boolean {
  if (typeof navigator === "undefined" || !navigator.serviceWorker || typeof MessageChannel === "undefined") return false;
  const choice = switched();
  if (choice === "off") return false;
  return choice === "on" || !webkitEngine();
}

/**
 * Has the download worker serve `att` as a stream, and gives the frame to
 * play it in; null when it cannot, and the video should download whole.
 * `preload` is what the video loads before it is played: its first chunk
 * (and so its length and first frame), or nothing.
 */
export async function openVideoStream(att: AttachmentMeta, preload: "metadata" | "none"): Promise<VideoStream | null> {
  if (!canStream()) return null;
  const worker = await downloadWorker();
  if (!worker) return null;
  const id = hex(randomBytes(16));
  const url = new URL(attachmentUrl(att.blob_id), location.href).href;
  // a webhook's file came unencrypted and is only fetched
  const key = att.plain ? null : b64.dec(att.key);
  const message = () => ({ type: "stream", id, url, token: api.getToken(), key, size: att.size, mime: att.type });
  const taken = await new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), READY_TIMEOUT);
    channel.port1.onmessage = (e: MessageEvent<{ type?: string } | null>) => done(e.data?.type === "stream-ready");
    worker.postMessage(message(), [channel.port2]);
  });
  if (!taken) return null;
  const say = (): void => void downloadWorker().then((w) => w?.postMessage(message()));
  const timer = setInterval(say, REFRESH_MS);
  open.set(id, say);
  listen();
  let closed = false;
  return {
    frame: `${PLAY_PATH}${id}?preload=${preload}`,
    failed: () => failed.has(id),
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      open.delete(id);
      failed.delete(id);
      void downloadWorker().then((w) => w?.postMessage({ type: "stream-forget", id }));
    },
  };
}
