/**
 * What the page may use: the microphone, camera, screen, notifications and
 * clipboard, for Evilion Chat's own origin and nothing else. On macOS the
 * system asks the person the first time the microphone or camera is wanted.
 */
import { desktopCapturer, session, systemPreferences, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import os from "node:os";
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
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // Electron hands the origin over as a URL with a trailing slash ("https://host/"), and
    // empty for some checks; compared as it came, every check failed and notifications stayed off
    const origin = originOf(requestingOrigin) || originOf(details.requestingUrl) || originOf(details.embeddingOrigin) || originOf(wc?.getURL());
    return origin === ORIGIN && ALLOWED.has(permission);
  });
  // nothing is ever loaded from anywhere else as a page, and downloads keep the system's own save flow
  ses.on("will-download", (_e, item) => {
    if (!isAppUrl(item.getURL()) && !item.getURL().startsWith("blob:") && !item.getURL().startsWith("data:")) item.cancel();
  });
}

const pending = new Map<string, { resolve: (sourceId: string | null, audio: boolean) => void }>();

/**
 * Answers the page's getDisplayMedia: the page shows its picker with the
 * screens and windows sent here, and exactly the one chosen is shared (on
 * Wayland the portal asks instead). macOS's own picker is not used: in
 * Electron it is experimental, and a window picked there could end up as the
 * whole screen.
 *
 * Sound comes as system loopback, where the platform has it and the share
 * asked for sound. When the page also asks for restrictOwnAudio, Electron
 * captures everything but this app's own playback, so a call never hears
 * itself back through the share.
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
          const audio = request.audioRequested && loopbackAudio();
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
  );
}

/**
 * Whether this computer can share its sound without the call's own sound in
 * it. Only a loopback that leaves this app out is offered: Windows 10 2004
 * (build 19041) and later, and macOS 14.2 and later. Older systems capture
 * the call along with everything else, which everyone else then hears echo
 * back, so their shares go without sound. EVILION_FORCE_LOOPBACK offers it
 * anyway, for testing the page's own check.
 */
export function loopbackAudio(): boolean {
  if (process.env.EVILION_FORCE_LOOPBACK) return true;
  const [major = 0, minor = 0, build = 0] = os.release().split(".").map(Number);
  if (process.platform === "win32") return major > 10 || (major === 10 && build >= 19041);
  // Darwin 23.2 is macOS 14.2
  if (process.platform === "darwin") return major > 23 || (major === 23 && minor >= 2);
  return false;
}

/** The page chose a source (null: the person cancelled). */
export function chooseDisplaySource(requestId: string, sourceId: string | null, withAudio: boolean): void {
  pending.get(requestId)?.resolve(sourceId, withAudio);
}
