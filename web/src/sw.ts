// Service worker: caches the app shell for offline starts and instant loads.
// Typed with a tiny local interface so it compiles under the DOM lib.
interface SWEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SWFetchEvent extends SWEvent {
  request: Request;
  respondWith(r: Promise<Response> | Response): void;
}
interface SWScope {
  addEventListener(type: "install" | "activate", fn: (e: SWEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: SWFetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
}

const sw = self as unknown as SWScope;
const CACHE = `ec-${__BUILD_ID__}`;
/** Emoji artwork is the same in every build, so it outlives one. */
const EMOJI_CACHE = "ec-twemoji-v1";
const NEVER = ["/api/", "/gateway", "/media/attachments/"];

sw.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon.svg"]))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== EMOJI_CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (NEVER.some((p) => url.pathname.startsWith(p))) return;
  // An error page served in place of a script or a picture must never be
  // kept: it would sit at that address until the cache is thrown away.
  const isAsset = (r: Response): boolean => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html");
  const cacheFirst = (cacheName: string) =>
    caches.open(cacheName).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (isAsset(res)) void c.put(req, res.clone());
      return res;
    });
  if (url.pathname.startsWith("/twemoji/")) {
    e.respondWith(cacheFirst(EMOJI_CACHE));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(cacheFirst(CACHE));
    return;
  }
  if (req.mode === "navigate" || url.pathname === "/") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) void caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (isAsset(res) && (url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest"))) void caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }),
    ),
  );
});
