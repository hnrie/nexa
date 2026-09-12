import { ApiError, api } from "./client";

interface Recorded {
  url: string;
  init: RequestInit;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Replaces api.fetchImpl with a recorder and returns the calls it makes. */
function useFetch(handler: Handler): Recorded[] {
  const calls: Recorded[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const rec: Recorded = { url, init: init ?? {} };
    calls.push(rec);
    return Promise.resolve(handler(url, rec.init));
  };
  api.fetchImpl = impl as unknown as typeof fetch;
  return calls;
}

function only(calls: Recorded[]): Recorded {
  const c = calls[0];
  if (!c) throw new Error("fetchImpl was never called");
  return c;
}

function headersOf(rec: Recorded): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries((rec.init.headers ?? {}) as Record<string, string>)) {
    h[k.toLowerCase()] = v;
  }
  return h;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A stand-in for XMLHttpRequest that records everything and is driven by hand. */
class FakeXHR {
  static last: FakeXHR | null = null;

  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown = null;
  aborted = false;
  status = 0;
  responseText = "";
  upload: { onprogress: ((ev: { loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private responseHeaders: Record<string, string> = {};

  constructor() {
    FakeXHR.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(k: string, v: string): void {
    this.headers[k.toLowerCase()] = v;
  }

  getResponseHeader(k: string): string | null {
    return this.responseHeaders[k.toLowerCase()] ?? null;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total });
  }

  respond(status: number, body: string, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseText = body;
    this.responseHeaders = {};
    for (const [k, v] of Object.entries(headers)) this.responseHeaders[k.toLowerCase()] = v;
    this.onload?.();
  }
}

function useXHR(): typeof FakeXHR {
  FakeXHR.last = null;
  api.XHRImpl = FakeXHR as unknown as typeof XMLHttpRequest;
  return FakeXHR;
}

function lastXHR(): FakeXHR {
  const x = FakeXHR.last;
  if (!x) throw new Error("no XMLHttpRequest was created");
  return x;
}

beforeEach(() => {
  api.baseUrl = "";
  api.setToken(null);
  api.onUnauthorized = null;
});

describe("ApiError", () => {
  it("is an Error carrying status, code and retryAfter", () => {
    const e = new ApiError(429, "rate_limited", "Slow down.", 7);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(429);
    expect(e.code).toBe("rate_limited");
    expect(e.message).toBe("Slow down.");
    expect(e.retryAfter).toBe(7);
  });

  it("leaves retryAfter undefined when not given", () => {
    expect(new ApiError(404, "not_found", "Nope.").retryAfter).toBeUndefined();
  });
});

describe("api.request", () => {
  it("resolves paths against /api/v1", async () => {
    const calls = useFetch(() => json({ id: "1" }));
    await api.request("GET", "/users/@me");
    expect(only(calls).url).toBe("/api/v1/users/@me");
    expect(only(calls).init.method).toBe("GET");
  });

  it("prefixes baseUrl", async () => {
    api.baseUrl = "https://chat.example";
    const calls = useFetch(() => json({}));
    await api.request("GET", "/users/@me");
    expect(only(calls).url).toBe("https://chat.example/api/v1/users/@me");
  });

  it("uses /media/ paths verbatim", async () => {
    const calls = useFetch(() => json({}));
    await api.request("GET", "/media/attachments/42");
    expect(only(calls).url).toBe("/media/attachments/42");
  });

  it("sends the bearer token once set", async () => {
    api.setToken("tok-123");
    expect(api.getToken()).toBe("tok-123");
    const calls = useFetch(() => json({}));
    await api.request("GET", "/users/@me");
    expect(headersOf(only(calls))["authorization"]).toBe("Bearer tok-123");
  });

  it("omits the Authorization header when signed out", async () => {
    const calls = useFetch(() => json({}));
    await api.request("GET", "/users/@me");
    expect(headersOf(only(calls))["authorization"]).toBeUndefined();
  });

  it("serializes a JSON body and sets the content type", async () => {
    const calls = useFetch(() => json({}));
    await api.request("POST", "/auth/login", { username: "mara", auth_key: "AA==" });
    const rec = only(calls);
    expect(rec.init.body).toBe('{"username":"mara","auth_key":"AA=="}');
    expect(headersOf(rec)["content-type"]).toBe("application/json");
  });

  it("sends opts.raw unchanged and adds no JSON content type", async () => {
    const calls = useFetch(() => json({}));
    await api.request("PUT", "/users/@me/avatar", undefined, {
      raw: "raw-bytes",
      headers: { "Content-Type": "image/png" },
    });
    const rec = only(calls);
    expect(rec.init.body).toBe("raw-bytes");
    expect(headersOf(rec)["content-type"]).toBe("image/png");
  });

  it("appends query params and skips undefined ones", async () => {
    const calls = useFetch(() => json([]));
    await api.request("GET", "/channels/7/messages", undefined, {
      query: { before: "99", limit: 50, after: undefined },
    });
    expect(only(calls).url).toBe("/api/v1/channels/7/messages?before=99&limit=50");
  });

  it("omits the query string when every param is undefined", async () => {
    const calls = useFetch(() => json([]));
    await api.request("GET", "/channels/7/messages", undefined, { query: { before: undefined } });
    expect(only(calls).url).toBe("/api/v1/channels/7/messages");
  });

  it("passes the abort signal through", async () => {
    const ctrl = new AbortController();
    const calls = useFetch(() => json({}));
    await api.request("GET", "/users/@me", undefined, { signal: ctrl.signal });
    expect(only(calls).init.signal).toBe(ctrl.signal);
  });

  it("returns undefined for 204", async () => {
    useFetch(() => new Response(null, { status: 204 }));
    await expect(api.request("DELETE", "/auth/sessions/9")).resolves.toBeUndefined();
  });

  it("returns undefined for an empty 200 body", async () => {
    useFetch(() => new Response("", { status: 200 }));
    await expect(api.request("POST", "/auth/logout")).resolves.toBeUndefined();
  });

  it("parses the error envelope into an ApiError", async () => {
    useFetch(() => json({ error: { code: "dm_closed", message: "No DMs." } }, 403));
    const err = await api.request("POST", "/users/@me/channels", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api_err = err as ApiError;
    expect(api_err.status).toBe(403);
    expect(api_err.code).toBe("dm_closed");
    expect(api_err.message).toBe("No DMs.");
  });

  it("falls back to http_<status> for an unrecognised error body", async () => {
    useFetch(() => new Response("<html>boom</html>", { status: 500 }));
    const err = (await api.request("GET", "/users/@me").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("http_500");
    expect(err.status).toBe(500);
  });

  it("reads Retry-After seconds into retryAfter", async () => {
    useFetch(() =>
      json({ error: { code: "rate_limited", message: "Too fast." } }, 429, {
        "retry-after": "12",
      }),
    );
    const err = (await api.request("POST", "/auth/login", {}).catch((e: unknown) => e)) as ApiError;
    expect(err.retryAfter).toBe(12);
  });

  it("leaves retryAfter undefined without the header", async () => {
    useFetch(() => json({ error: { code: "not_found", message: "Nope." } }, 404));
    const err = (await api.request("GET", "/users/1").catch((e: unknown) => e)) as ApiError;
    expect(err.retryAfter).toBeUndefined();
  });

  it("calls onUnauthorized once for each 401 of an authenticated request", async () => {
    api.setToken("tok");
    let hits = 0;
    api.onUnauthorized = () => {
      hits += 1;
    };
    useFetch(() => json({ error: { code: "unauthorized", message: "Log in." } }, 401));
    await api.request("GET", "/users/@me").catch(() => undefined);
    expect(hits).toBe(1);
    await api.request("GET", "/users/@me").catch(() => undefined);
    expect(hits).toBe(2);
  });

  it("does not call onUnauthorized for a 401 of an unauthenticated request", async () => {
    let hits = 0;
    api.onUnauthorized = () => {
      hits += 1;
    };
    useFetch(() => json({ error: { code: "unauthorized", message: "Log in." } }, 401));
    await api.request("POST", "/auth/login", {}).catch(() => undefined);
    expect(hits).toBe(0);
  });
});

describe("api.upload", () => {
  it("POSTs to /api/v1 with the token and an octet-stream content type", async () => {
    useXHR();
    const p = api.upload<{ blob_id: string }>("/channels/7/attachments", new Uint8Array([1, 2, 3]));
    const xhr = lastXHR();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/v1/channels/7/attachments");
    expect(xhr.headers["content-type"]).toBe("application/octet-stream");
    xhr.respond(200, JSON.stringify({ blob_id: "9" }));
    await expect(p).resolves.toEqual({ blob_id: "9" });
  });

  it("sends the bearer token", async () => {
    api.setToken("tok-xhr");
    useXHR();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]));
    const xhr = lastXHR();
    expect(xhr.headers["authorization"]).toBe("Bearer tok-xhr");
    xhr.respond(200, "{}");
    await p;
  });

  it("honours an explicit method and content type", async () => {
    useXHR();
    const p = api.upload("/users/@me/avatar", new Uint8Array([1]), {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
    });
    const xhr = lastXHR();
    expect(xhr.method).toBe("PUT");
    expect(xhr.headers["content-type"]).toBe("image/png");
    xhr.respond(200, "{}");
    await p;
  });

  it("reports upload progress", async () => {
    useXHR();
    const seen: [number, number][] = [];
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]), {
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    const xhr = lastXHR();
    xhr.progress(10, 100);
    xhr.progress(100, 100);
    xhr.respond(200, "{}");
    await p;
    expect(seen).toEqual([
      [10, 100],
      [100, 100],
    ]);
  });

  it("resolves undefined for an empty body", async () => {
    useXHR();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]));
    lastXHR().respond(204, "");
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects with an ApiError built from the error envelope", async () => {
    useXHR();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]));
    lastXHR().respond(413, JSON.stringify({ error: { code: "too_large", message: "Too big." } }), {
      "Retry-After": "3",
    });
    const err = (await p.catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
    expect(err.code).toBe("too_large");
    expect(err.retryAfter).toBe(3);
  });

  it("fires onUnauthorized on a 401 of an authenticated upload", async () => {
    api.setToken("tok");
    let hits = 0;
    api.onUnauthorized = () => {
      hits += 1;
    };
    useXHR();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]));
    lastXHR().respond(401, JSON.stringify({ error: { code: "unauthorized", message: "Log in." } }));
    await p.catch(() => undefined);
    expect(hits).toBe(1);
  });

  it("rejects when the transport fails", async () => {
    useXHR();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]));
    lastXHR().onerror?.();
    const err = (await p.catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("network");
  });

  it("aborts when the signal fires", async () => {
    useXHR();
    const ctrl = new AbortController();
    const p = api.upload("/channels/7/attachments", new Uint8Array([1]), { signal: ctrl.signal });
    const xhr = lastXHR();
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    const err = (await p.catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("aborted");
  });

  it("rejects when no XMLHttpRequest is available", async () => {
    api.XHRImpl = null;
    const err = (await api
      .upload("/channels/7/attachments", new Uint8Array([1]))
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("no_xhr");
  });
});
