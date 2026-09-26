// The app's service worker. It has one job: when a deploy ships a new build,
// a new copy of this script takes over every open tab, which the page notices
// and offers as an update (see main.tsx and lib/appUpdate.ts).
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
interface SWNotificationEvent extends SWEvent {
  notification: { data: unknown; close(): void };
}
interface SWWindowClient {
  url: string;
  focused: boolean;
  visibilityState: DocumentVisibilityState;
  frameType: string;
  focus(): Promise<unknown>;
  postMessage(msg: unknown): void;
}
interface SWScope {
  addEventListener(type: "install" | "activate", fn: (e: SWEvent) => void): void;
  addEventListener(type: "notificationclick", fn: (e: SWNotificationEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(opts: { type: "window"; includeUncontrolled: boolean }): Promise<SWWindowClient[]>;
    openWindow(url: string): Promise<unknown>;
  };
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

// Notifications are shown through this worker whenever it runs, since phones
// allow no other way (see lib/notify.ts), so their clicks arrive here. Bring the app forward and let it open the chat
// itself, which keeps the page instead of reloading it; with no app open,
// start one at that chat.
sw.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data as { path?: unknown } | null;
  // a test notification names no chat: it only brings the app forward
  const path = typeof data?.path === "string" && data.path.startsWith("/") ? data.path : null;
  e.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      // the frames that stream downloads are not the app
      const apps = all.filter((c) => c.frameType !== "nested" && !new URL(c.url).pathname.startsWith("/__download/"));
      const win = apps.find((c) => c.focused) ?? apps.find((c) => c.visibilityState === "visible") ?? apps[0];
      if (!win) return sw.clients.openWindow(path ?? "/");
      if (path) win.postMessage({ type: "notification-open", path });
      return win.focus().catch(() => undefined);
    }),
  );
});
