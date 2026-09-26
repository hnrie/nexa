/**
 * Still frames of the stickers the server cannot draw: a Telegram animated
 * sticker (gzipped Lottie) and a video sticker. Each is drawn once, here, on
 * a canvas of its own, and handed back as a small picture. The players they
 * need are gone again before this returns, which is the point: a grid of
 * players, one per tile, is what used to leave tiles grey (see
 * stickerStills.ts).
 */
import type { AnimationConfigWithData } from "lottie-web";
import { AbortedError } from "./loadQueue";

/** A failure trying again will not fix, such as a format this browser cannot play. */
export class UnsupportedError extends Error {
  override name = "UnsupportedError";
}

/** Unzips a .tgs file into its Lottie text. */
export async function unzipTgs(data: Blob): Promise<string> {
  if (typeof DecompressionStream === "undefined") throw new UnsupportedError("no gzip stream");
  return new Response(data.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // WebP is a fraction of PNG's size; a browser that cannot write it writes PNG
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas could not be read"))), "image/webp", 0.9);
  });
}

/** Waits for work that ends in an event, giving up when aborted or after ms. */
function abortable<T>(signal: AbortSignal, work: (done: (v: T) => void, fail: (e: unknown) => void) => () => void, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    let settled = false;
    let cleanup: (() => void) | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      cleanup?.();
      fn();
    };
    const onAbort = () => finish(() => reject(new AbortedError()));
    const timer = setTimeout(() => finish(() => reject(new Error("timed out"))), ms);
    signal.addEventListener("abort", onAbort);
    const undo = work(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
    if (settled) undo();
    else cleanup = undo;
  });
}

interface LottieItem {
  isLoaded: boolean;
  goToAndStop(value: number, isFrame?: boolean): void;
  addEventListener(name: string, fn: () => void): unknown;
  destroy(): void;
}

/** The first frame of a Telegram animated sticker, px across. */
export async function tgsPoster(data: Blob, px: number, signal: AbortSignal): Promise<Blob> {
  const doc: unknown = JSON.parse(await unzipTgs(data));
  const lottie = (await import("lottie-web")).default;
  if (signal.aborted) throw new AbortedError();
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  // No container: the player draws straight onto this canvas, at its size
  // (the types insist on one, the player does not).
  const config = {
    renderer: "canvas",
    loop: false,
    autoplay: false,
    animationData: doc,
    rendererSettings: { context, clearCanvas: true, preserveAspectRatio: "xMidYMid meet", dpr: 1 },
  } as unknown as AnimationConfigWithData<"canvas">;
  const anim = lottie.loadAnimation(config) as unknown as LottieItem;
  try {
    await abortable<void>(signal, (done, fail) => {
      if (anim.isLoaded) done();
      anim.addEventListener("DOMLoaded", () => done());
      anim.addEventListener("data_failed", () => fail(new Error("tgs data failed")));
      return () => undefined;
    }, 15_000);
    anim.goToAndStop(0, true);
    return await canvasBlob(canvas);
  } finally {
    anim.destroy();
  }
}

/** Whether this browser can play video stickers at all (Telegram's are VP9 WebM). */
export function canPlayWebm(): boolean {
  if (typeof document === "undefined") return false;
  return document.createElement("video").canPlayType('video/webm; codecs="vp9"') !== "";
}

/**
 * The first frame of a video sticker, no more than px across. The player
 * fetches only as much of the file as that frame needs, and is let go before
 * this returns: taking its source away frees it now, rather than whenever the
 * page next collects garbage. A download that goes quiet for stallMs is given
 * up (the caller tries again later).
 */
export async function webmPoster(url: string, px: number, signal: AbortSignal, stallMs = 20_000): Promise<Blob> {
  if (!canPlayWebm()) throw new UnsupportedError("webm");
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  try {
    await abortable<void>(signal, (done, fail) => {
      let quiet = setTimeout(() => fail(new Error("video stalled")), stallMs);
      const progress = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => fail(new Error("video stalled")), stallMs);
      };
      const ready = () => {
        if (v.readyState >= 2) done();
      };
      // code 4 is also what a browser answers when it will not make another player
      const error = () => fail(new Error(v.error?.code === 4 ? "video refused" : "video failed"));
      v.addEventListener("loadeddata", ready);
      v.addEventListener("canplay", ready);
      v.addEventListener("progress", progress);
      v.addEventListener("error", error);
      v.src = url;
      v.load();
      return () => {
        clearTimeout(quiet);
        v.removeEventListener("loadeddata", ready);
        v.removeEventListener("canplay", ready);
        v.removeEventListener("progress", progress);
        v.removeEventListener("error", error);
      };
    }, 120_000);
    const w = v.videoWidth || px;
    const h = v.videoHeight || px;
    const scale = Math.min(1, px / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}
