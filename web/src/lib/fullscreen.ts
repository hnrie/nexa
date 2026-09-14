/**
 * Full screen that works on phones too.
 *
 * Desktop browsers, Android and iPad Safari (with the webkit prefix before
 * 16.4) can put any element full screen. iPhone Safari cannot: there only a
 * <video> goes full screen, into the system player. So a single stream uses
 * that player on an iPhone, and the whole call covers the app inside the page
 * instead ("page"), which is edge to edge when the app is on the home screen.
 */

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export type FullscreenWay = "element" | "video" | "page";

function elementFullscreenOn(doc: Document): boolean {
  const d = doc as WebkitDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

/** How the whole call goes full screen here. */
export function callFullscreenWay(doc: Document = document): Exclude<FullscreenWay, "video"> {
  return elementFullscreenOn(doc) ? "element" : "page";
}

/** How one stream goes full screen here. */
export function streamFullscreenWay(doc: Document = document, video: HTMLVideoElement | undefined = typeof HTMLVideoElement === "undefined" ? undefined : HTMLVideoElement.prototype): FullscreenWay {
  if (elementFullscreenOn(doc)) return "element";
  if (video && typeof (video as WebkitVideo).webkitEnterFullscreen === "function") return "video";
  return "page";
}

export function fullscreenElement(doc: Document = document): Element | null {
  return doc.fullscreenElement ?? (doc as WebkitDocument).webkitFullscreenElement ?? null;
}

export async function enterElementFullscreen(el: HTMLElement): Promise<void> {
  if (typeof el.requestFullscreen === "function") await el.requestFullscreen({ navigationUI: "hide" });
  else (el as WebkitElement).webkitRequestFullscreen?.();
}

export async function exitElementFullscreen(doc: Document = document): Promise<void> {
  if (!fullscreenElement(doc)) return;
  if (typeof doc.exitFullscreen === "function") await doc.exitFullscreen();
  else (doc as WebkitDocument).webkitExitFullscreen?.();
}

/** Calls back whenever something enters or leaves element full screen. */
export function onFullscreenChange(cb: () => void, doc: Document = document): () => void {
  doc.addEventListener("fullscreenchange", cb);
  doc.addEventListener("webkitfullscreenchange", cb);
  return () => {
    doc.removeEventListener("fullscreenchange", cb);
    doc.removeEventListener("webkitfullscreenchange", cb);
  };
}

/** Opens the system player on a video (iPhone); false where there is none or it refuses. */
export function enterVideoFullscreen(video: HTMLVideoElement): boolean {
  const v = video as WebkitVideo;
  if (typeof v.webkitEnterFullscreen !== "function") return false;
  try {
    v.webkitEnterFullscreen();
    return true;
  } catch {
    return false;
  }
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Turns a phone sideways for a wide picture; only works while full screen, and not at all on iOS. */
export async function lockLandscape(): Promise<boolean> {
  try {
    const o = (typeof screen === "undefined" ? undefined : screen.orientation) as LockableOrientation | undefined;
    if (!o?.lock) return false;
    await o.lock("landscape");
    return true;
  } catch {
    return false;
  }
}

export function unlockOrientation(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* nothing was locked */
  }
}
