// Download service worker, registered for /__download/ only.
//
// It streams large attachments to disk: the page registers a job with the
// file's address, key and name, then points a hidden frame at
// /__download/<id>, and the answer is a stream this worker fills by fetching
// and decrypting one chunk at a time as the browser's download manager asks.
//
// It lives apart from the app's own worker (sw.ts) on purpose. A service worker
// with a fetch handler is shown every request its pages make, uploads
// included, and Chrome keeps each of those request bodies alive until that
// worker's garbage collector runs: sending a 6 GB file from a page under one
// took gigabytes of memory. This worker's scope holds no pages, so nothing the
// app sends ever passes through it.
//
// This file is loaded as a classic script, so the build must not leave an
// import in it: whatever it uses from src/ has to be used by nothing else.
import { FileCorrupt, Permanent, decryptStream, type CipherBody, type PlainStream } from "./crypto/streamDecrypt";

interface SWEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SWFetchEvent extends SWEvent {
  request: Request;
  respondWith(r: Promise<Response> | Response): void;
}
interface SWMessageEvent extends SWEvent {
  data: unknown;
  ports: readonly MessagePort[];
}
interface SWScope {
  addEventListener(type: "install" | "activate", fn: (e: SWEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: SWFetchEvent) => void): void;
  addEventListener(type: "message", fn: (e: SWMessageEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
}

const sw = self as unknown as SWScope;

sw.addEventListener("install", (e) => {
  e.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(sw.clients.claim());
});

const DOWNLOAD_PATH = "/__download/";
/** A job the browser has not come for within this long is dropped, key and all. */
const JOB_TTL = 60_000;
const JOB_ID = /^[0-9a-f]{32}$/;

interface DownloadJob {
  url: string;
  token: string | null;
  key: Uint8Array;
  name: string;
  size: number;
  port: MessagePort;
  at: number;
}

const jobs = new Map<string, DownloadJob>();
const streams = new Map<string, PlainStream>();

function readJob(msg: Record<string, unknown>, port: MessagePort): DownloadJob | null {
  const { url, token, key, name, size } = msg;
  if (typeof url !== "string" || !(key instanceof Uint8Array) || typeof name !== "string") return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
  if (token !== null && typeof token !== "string") return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  // the token only ever goes to this app's own attachments
  if (target.origin !== sw.location.origin || !target.pathname.startsWith("/media/attachments/")) return null;
  return { url: target.href, token, key, name, size, port, at: Date.now() };
}

sw.addEventListener("message", (e) => {
  if (!e.data || typeof e.data !== "object") return;
  const msg = e.data as Record<string, unknown>;
  const id = typeof msg["id"] === "string" && JOB_ID.test(msg["id"]) ? msg["id"] : null;
  const port = e.ports[0];
  if (msg["type"] === "download" && id && port) {
    const now = Date.now();
    for (const [k, job] of jobs) {
      if (now - job.at > JOB_TTL) jobs.delete(k);
    }
    const job = readJob(msg, port);
    if (!job) {
      port.postMessage({ type: "error", message: "That download could not be started." });
      return;
    }
    jobs.set(id, job);
    port.postMessage({ type: "ready" });
    return;
  }
  if (msg["type"] === "download-forget" && id) {
    jobs.delete(id);
    void streams.get(id)?.cancel();
  }
  // "keepalive" needs no answer: receiving it is what keeps this worker running
});

/** Fetches the ciphertext from `offset` onwards, sorting failures worth retrying from those that are not. */
async function openCipher(job: DownloadJob, offset: number): Promise<CipherBody> {
  const headers: Record<string, string> = {};
  if (job.token) headers["Authorization"] = `Bearer ${job.token}`;
  if (offset > 0) headers["Range"] = `bytes=${offset}-`;
  const res = await fetch(job.url, { headers, cache: "no-store" });
  if (res.body && (res.status === 200 || res.status === 206)) {
    let start = 0;
    if (res.status === 206) {
      const m = /^bytes (\d+)-/.exec(res.headers.get("Content-Range") ?? "");
      if (!m) {
        void res.body.cancel().catch(() => undefined);
        throw new Permanent("The server sent part of the file without saying which part.");
      }
      start = Number(m[1]);
    }
    return { reader: res.body.getReader(), start };
  }
  void res.body?.cancel().catch(() => undefined);
  if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Error(`download: the server answered ${res.status}`);
  if (res.status === 404) throw new Permanent("That file is no longer on the server.");
  if (res.status === 401 || res.status === 403) throw new Permanent("You no longer have access to that file.");
  throw new Permanent(`The server refused the download (${res.status}).`);
}

function failure(err: unknown): string {
  if (err instanceof FileCorrupt) return "This file could not be decrypted. It may be damaged.";
  if (err instanceof Permanent) return err.message;
  return "The connection kept dropping, so the download stopped.";
}

/** A header the browser will accept for any file name, with the real name alongside for those that read it. */
function disposition(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/]/g, "_").trim() || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function streamDownload(id: string): Response {
  const job = jobs.get(id);
  jobs.delete(id);
  // nothing waiting under that name: answer with nothing rather than the app
  if (!job) return new Response(null, { status: 204 });
  const { port, size } = job;
  const tell = (msg: Record<string, unknown>): void => {
    try {
      port.postMessage(msg);
    } catch {
      /* the page has gone; the download carries on without it */
    }
  };
  const source = decryptStream({ key: job.key, size, open: (offset) => openCipher(job, offset) });
  streams.set(id, source);
  let produced = 0;
  let told = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const chunk = await source.next();
          if (!chunk) {
            // Stopping short has to fail. Closing the stream instead would
            // leave a cut-off file on disk looking like a whole one.
            if (produced !== size) throw new Error("download: stopped before the end of the file");
            streams.delete(id);
            controller.close();
            tell({ type: "done" });
            return;
          }
          if (chunk.length === 0) continue;
          controller.enqueue(chunk);
          produced += chunk.length;
          const now = Date.now();
          if (now - told >= 250) {
            told = now;
            tell({ type: "progress", done: produced });
          }
          return;
        }
      } catch (err) {
        streams.delete(id);
        void source.cancel();
        controller.error(err);
        tell({ type: "error", message: failure(err) });
      }
    },
    cancel() {
      streams.delete(id);
      void source.cancel();
      tell({ type: "cancelled" });
    },
  });
  tell({ type: "started" });
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": disposition(job.name),
      "Content-Length": String(size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

sw.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== sw.location.origin || !url.pathname.startsWith(DOWNLOAD_PATH)) return;
  e.respondWith(streamDownload(url.pathname.slice(DOWNLOAD_PATH.length)));
});
