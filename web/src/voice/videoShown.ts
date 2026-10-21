/**
 * Whether a call's pictures are on screen anywhere: a call view of it is open
 * on a page someone can see, or one of its videos floats in picture in
 * picture (which carries on after the page moves elsewhere, and while it is
 * hidden). While they are not, the transport stops pulling cameras and shares
 * (sfu.ts setVideoShown): a share watched and then left behind in another
 * channel otherwise kept coming in at up to 10 Mbit/s and being decoded for
 * nobody. Voices, and a share's sound, keep coming either way.
 *
 * The desktop app keeps a call's page awake, and so counted as visible, while
 * its window is minimised or in the tray; there the window's own state says.
 */
import { useDesktop } from "@/stores/desktop";

const mounted = new Map<string, number>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of [...listeners]) l();
}

/** A call view of `channelId` is on the page; call what this returns when it goes. */
export function callViewOpen(channelId: string): () => void {
  mounted.set(channelId, (mounted.get(channelId) ?? 0) + 1);
  changed();
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    const n = (mounted.get(channelId) ?? 1) - 1;
    if (n > 0) mounted.set(channelId, n);
    else mounted.delete(channelId);
    changed();
  };
}

/** Whether a video floats in picture in picture: the standard way, or Safari's own. */
function floating(): boolean {
  if (typeof document === "undefined") return false;
  if ((document as Document & { pictureInPictureElement?: Element | null }).pictureInPictureElement) return true;
  for (const v of document.querySelectorAll("video")) if ((v as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode === "picture-in-picture") return true;
  return false;
}

/** Whether `channelId`'s pictures are on screen now. */
export function videoShown(channelId: string): boolean {
  if (floating()) return true;
  const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  const w = useDesktop.getState().window;
  return visible && (!w || (w.visible && !w.minimized)) && (mounted.get(channelId) ?? 0) > 0;
}

/** Looks again everywhere: the call moved to another channel. */
export function recheckVideoShown(): void {
  changed();
}

/**
 * Calls `cb` with whether the pictures of the call in `channel()` are on
 * screen, now and whenever that changes, until the returned function is called.
 */
export function watchVideoShown(channel: () => string, cb: (shown: boolean) => void): () => void {
  let last: boolean | null = null;
  const check = () => {
    const now = videoShown(channel());
    if (now === last) return;
    last = now;
    cb(now);
  };
  listeners.add(check);
  const offWindow = useDesktop.subscribe((st, prev) => {
    if (st.window !== prev.window) check();
  });
  // picture in picture's events do not bubble, so they are caught on the way down
  const events = ["visibilitychange", "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged"];
  if (typeof document !== "undefined") for (const e of events) document.addEventListener(e, check, true);
  check();
  return () => {
    listeners.delete(check);
    offWindow();
    if (typeof document !== "undefined") for (const e of events) document.removeEventListener(e, check, true);
  };
}
