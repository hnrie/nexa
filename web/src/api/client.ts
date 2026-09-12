/**
 * The typed HTTP client.
 *
 * Everything goes through `api.request`, which knows three things the rest of
 * the app should not have to: where the API lives, how the bearer token is
 * attached, and what the server's error envelope looks like. `fetchImpl` and
 * `XHRImpl` are injectable so tests never touch the network.
 */

/** The base path every API route hangs off. */
const API_PREFIX = "/api/v1";

/** An error the server reported, or a transport failure dressed up as one. */
export class ApiError extends Error {
  status: number;
  code: string;
  retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface RequestOptions {
  /** Send this body as-is instead of JSON-encoding `body`. */
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Appended as a query string; `undefined` values are dropped. */
  query?: Record<string, string | number | undefined>;
}

export interface UploadOptions {
  headers?: Record<string, string>;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** Defaults to POST; avatars, banners and icons are PUT. */
  method?: string;
}

/** The server's error envelope: `{ "error": { "code": ..., "message": ... } }`. */
interface ErrorEnvelope {
  error: { code: string; message: string };
}

function isErrorEnvelope(x: unknown): x is ErrorEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const e = (x as { error?: unknown }).error;
  if (typeof e !== "object" || e === null) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string";
}

/** Retry-After is sent in seconds; anything else is ignored. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Builds an ApiError from a response body, falling back to `http_<status>`. */
function errorFrom(status: number, body: string, retryAfterHeader: string | null): ApiError {
  const retryAfter = parseRetryAfter(retryAfterHeader);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    parsed = undefined;
  }
  if (isErrorEnvelope(parsed)) {
    return new ApiError(status, parsed.error.code, parsed.error.message, retryAfter);
  }
  return new ApiError(status, `http_${status}`, `Request failed with status ${status}.`, retryAfter);
}

/** Builds an ApiError from a fetch Response that was not ok. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  return errorFrom(res.status, text, res.headers.get("Retry-After"));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const want = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === want);
}

let token: string | null = null;

const defaultFetch: typeof fetch =
  typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : (() => {
        throw new ApiError(0, "no_fetch", "This environment has no fetch().");
      }) as unknown as typeof fetch;

export const api = {
  /** Origin the API is served from; empty means same origin. */
  baseUrl: "",

  /** Called once for every 401 that came back from an authenticated request. */
  onUnauthorized: null as (() => void) | null,

  fetchImpl: defaultFetch,

  XHRImpl: (typeof XMLHttpRequest !== "undefined" ? XMLHttpRequest : null) as
    | typeof XMLHttpRequest
    | null,

  setToken(t: string | null): void {
    token = t;
  },

  getToken(): string | null {
    return token;
  },

  /** Absolute URL for a path; `/media/...` is used verbatim, the rest is versioned. */
  url(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.baseUrl + (path.startsWith("/media/") ? path : API_PREFIX + path);
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  async request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...opts?.headers };
    const auth = token;
    if (auth) headers["Authorization"] = `Bearer ${auth}`;

    let payload: BodyInit | undefined;
    if (opts?.raw !== undefined) {
      payload = opts.raw;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
    }

    const init: RequestInit = { method, headers };
    if (payload !== undefined) init.body = payload;
    if (opts?.signal) init.signal = opts.signal;

    const res = await this.fetchImpl(this.url(path, opts?.query), init);
    const raw = res.status === 204 || res.status === 205 ? "" : await res.text();

    if (!res.ok) {
      if (res.status === 401 && auth) this.onUnauthorized?.();
      throw errorFrom(res.status, raw, res.headers.get("Retry-After"));
    }
    if (!raw) return undefined as T;
    return JSON.parse(raw) as T;
  },

  /**
   * Uploads bytes with progress. fetch() cannot report upload progress, so this
   * is the one place that still uses XMLHttpRequest.
   */
  upload<T>(path: string, body: Blob | ArrayBuffer | Uint8Array, opts?: UploadOptions): Promise<T> {
    const XHR = this.XHRImpl;
    const onUnauthorized = (): void => this.onUnauthorized?.();
    if (!XHR) {
      return Promise.reject(
        new ApiError(0, "no_xhr", "Uploads need a browser environment with XMLHttpRequest."),
      );
    }
    const url = this.url(path);
    const auth = token;
    const headers = opts?.headers ?? {};

    return new Promise<T>((resolve, reject) => {
      const xhr = new XHR();
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      xhr.open(opts?.method ?? "POST", url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      if (!hasHeader(headers, "content-type")) {
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
      }
      if (auth) xhr.setRequestHeader("Authorization", `Bearer ${auth}`);

      const onProgress = opts?.onProgress;
      if (onProgress) {
        xhr.upload.onprogress = (ev: ProgressEvent): void => onProgress(ev.loaded, ev.total);
      }

      xhr.onload = (): void =>
        finish(() => {
          const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
          if (xhr.status >= 200 && xhr.status < 300) {
            if (!text) {
              resolve(undefined as T);
              return;
            }
            resolve(JSON.parse(text) as T);
            return;
          }
          if (xhr.status === 401 && auth) onUnauthorized();
          reject(errorFrom(xhr.status, text, xhr.getResponseHeader("Retry-After")));
        });

      xhr.onerror = (): void =>
        finish(() => reject(new ApiError(0, "network", "The upload could not reach the server.")));

      xhr.onabort = (): void =>
        finish(() => reject(new ApiError(0, "aborted", "The upload was cancelled.")));

      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }

      xhr.send(body as XMLHttpRequestBodyInit);
    });
  },
};
