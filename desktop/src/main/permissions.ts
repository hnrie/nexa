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
 * Sound comes from system loopback when the share asked for it, leaving this
 * app's own playback out wherever the system can (see shareAudioMode).
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
          const mode = shareAudioMode();
          const audio = request.audioRequested && mode !== "none";
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
            // Electron hands any device name over to Chromium; its typings only list "loopback" and "loopbackWithMute"
            const device = (mode === "own" ? "loopbackWithoutChrome" : "loopback") as "loopback";
            callback(source ? { video: source, ...(withAudio && audio ? { audio: device } : {}) } : {});
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
 * What sound a screen share can carry on this computer.
 *
 * "own": everything the computer plays except this app, so nobody in the call
 * hears themselves come back through the share. Chromium's
 * loopbackWithoutChrome capture does this with Windows' process loopback
 * (excluding this app's process tree) and with ScreenCaptureKit on macOS.
 * It is asked for by name: asking for plain "loopback" with the page's
 * restrictOwnAudio constraint is meant to get the same, but the constraint
 * never reaches Electron's handler, so the call leaked into every share.
 * Windows 10 22H2 (build 19045) and later honour it, which Vesktop found in
 * practice although Microsoft documents build 20348; macOS 13 and later,
 * measured on this build's Mac (the app's own sound at silence, other
 * programs still heard).
 *
 * "all": the whole system's sound, this app included, where the exclusion is
 * not there (older Windows 10). Sharing sound still works; the call may echo.
 *
 * "none": no system sound can be shared (Linux, macOS before 13).
 */
export type ShareAudioMode = "own" | "all" | "none";

export function shareAudioMode(): ShareAudioMode {
  const forced = process.env.EVILION_SHARE_AUDIO_MODE;
  if (forced === "own" || forced === "all" || forced === "none") return forced;
  const [major = 0, , build = 0] = os.release().split(".").map(Number);
  if (process.platform === "win32") return build >= 19045 ? "own" : "all";
  // Darwin 22 is macOS 13
  if (process.platform === "darwin") return major >= 22 ? "own" : "none";
  return "none";
}

/** The page chose a source (null: the person cancelled). */
export function chooseDisplaySource(requestId: string, sourceId: string | null, withAudio: boolean): void {
  pending.get(requestId)?.resolve(sourceId, withAudio);
}
