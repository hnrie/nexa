/**
 * Sends one request's body, then is thrown away.
 *
 * A browser keeps a request's body until its garbage collector gets round to
 * the finished request, and nothing about a finished upload makes it hurry:
 * sent from the page, a large file's pieces pile up until memory runs out.
 * The body is handed over to a worker instead, not copied, and the worker is
 * ended as soon as its request is answered, which frees all of it at once.
 */

export interface PieceRequest {
  url: string;
  method: "POST" | "PATCH";
  headers: Record<string, string>;
  /** Transferred, not copied: the page no longer holds these bytes once sent here. */
  body: ArrayBuffer;
}

export type PieceReply =
  | { type: "progress"; loaded: number }
  | { type: "done"; status: number; text: string; retryAfter: string | null }
  | { type: "failed" };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PieceRequest>) => void) | null;
  postMessage(msg: PieceReply): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const job = e.data;
  const xhr = new XMLHttpRequest();
  xhr.open(job.method, job.url);
  for (const [k, v] of Object.entries(job.headers)) xhr.setRequestHeader(k, v);
  xhr.upload.onprogress = (ev) => scope.postMessage({ type: "progress", loaded: ev.loaded });
  xhr.onload = () => scope.postMessage({ type: "done", status: xhr.status, text: typeof xhr.responseText === "string" ? xhr.responseText : "", retryAfter: xhr.getResponseHeader("Retry-After") });
  xhr.onerror = () => scope.postMessage({ type: "failed" });
  xhr.onabort = () => scope.postMessage({ type: "failed" });
  xhr.send(job.body);
};
