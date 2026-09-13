// The app's service worker. It has one job: when a deploy ships a new build,
// a new copy of this script takes over every open tab, which the page notices
// and reloads into (see main.tsx).
//
// It deliberately has no fetch handler. A worker with one is shown every
// request its pages make, and Chrome keeps each request body alive until that
// worker's garbage collector gets round to it: uploading a 6 GB file under the
// old caching worker took gigabytes of memory. Without one, requests go
// straight to the network. Scripts, styles and emoji are cached by the browser
// anyway, since they are served as immutable. Large downloads are streamed by
// a separate worker registered for /__download/ (download-sw.ts).
//
// Typed with a tiny local interface so it compiles under the DOM lib.

interface SWEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SWScope {
  addEventListener(type: "install" | "activate", fn: (e: SWEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

const sw = self as unknown as SWScope & { build?: string };
// Differs for every build, so each deploy's copy of this script is new to the
// browser and replaces the last. Kept on the global so the build keeps it.
sw.build = __BUILD_ID__;

sw.addEventListener("install", (e) => {
  e.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      // what earlier builds cached is served by the browser's own cache now
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ec-")).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});
