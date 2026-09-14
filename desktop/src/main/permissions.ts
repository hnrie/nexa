/**
 * What the page may use: the microphone, camera, screen, notifications and
 * clipboard, for Evilion Chat's own origin and nothing else. On macOS the
 * system asks the person the first time the microphone or camera is wanted.
 */
import { desktopCapturer, session, systemPreferences, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { IPC, type DisplaySourceRequest } from "../shared/bridge";
import { isAppUrl, originOf, ORIGIN } from "./config";

const ALLOWED = new Set(["media", "notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen", "display-capture", "speaker-selection", "pointerLock"]);

export function lockPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf((details as { requestingUrl?: string }).requestingUrl ?? wc.getURL());
    if (origin !== ORIGIN || !ALLOWED.has(permission)) {
      callback(false);
      return;
    }
    if (permission === "media" && process.platform === "darwin") {
      const kinds = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      void (async () => {
        const mic = kinds.includes("audio") ? await systemPreferences.askForMediaAccess("microphone") : true;
        const cam = kinds.includes("video") ? await systemPreferences.askForMediaAccess("camera") : true;
        callback(mic && cam);
      })();
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => requestingOrigin === ORIGIN && ALLOWED.has(permission));
  // nothing is ever loaded from anywhere else as a page, and downloads keep the system's own save flow
  ses.on("will-download", (_e, item) => {
    if (!isAppUrl(item.getURL()) && !item.getURL().startsWith("blob:") && !item.getURL().startsWith("data:")) item.cancel();
  });
}

const pending = new Map<string, { resolve: (sourceId: string | null, audio: boolean) => void }>();

/**
 * Answers the page's getDisplayMedia. On macOS 15 and later the system's own
 * picker is used; elsewhere the page shows its picker with the screens and
 * windows sent here, and Wayland's portal shows its own.
 */
export function handleDisplayMedia(getWindow: () => BrowserWindow | null): void {
  const wayland = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        if (!isAppUrl(request.securityOrigin) && originOf(request.frame?.url) !== ORIGIN) {
          callback({});
          return;
        }
        try {
          if (wayland) {
            // the portal asks the person itself, and hands back just the one they chose
            const [source] = await desktopCapturer.getSources({ types: ["screen", "window"] });
            callback(source ? { video: source } : {});
            return;
          }
          const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
          const win = getWindow();
          if (!win || sources.length === 0) {
            callback({});
            return;
          }
          const requestId = randomUUID();
          const audio = process.platform === "win32";
          const req: DisplaySourceRequest = {
            requestId,
            audio,
            sources: sources.map((s) => ({
              id: s.id,
              name: s.name,
              kind: s.id.startsWith("screen:") ? "screen" : "window",
              thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(),
              ...(s.appIcon && !s.appIcon.isEmpty() ? { icon: s.appIcon.toDataURL() } : {}),
            })),
          };
          const timer = setTimeout(() => answer(null, false), 120_000);
          const answer = (sourceId: string | null, withAudio: boolean) => {
            clearTimeout(timer);
            pending.delete(requestId);
            const source = sources.find((s) => s.id === sourceId);
            callback(source ? { video: source, ...(withAudio && audio ? { audio: "loopback" as const } : {}) } : {});
          };
          pending.set(requestId, { resolve: answer });
          win.webContents.send(IPC.displaySources, req);
          if (!win.isVisible()) win.show();
        } catch {
          callback({});
        }
      })();
    },
    { useSystemPicker: true },
  );
}

/** The page chose a source (null: the person cancelled). */
export function chooseDisplaySource(requestId: string, sourceId: string | null, withAudio: boolean): void {
  pending.get(requestId)?.resolve(sourceId, withAudio);
}
