const MAX_W = 550;
const MAX_H = 350;

/** The narrowest and shortest a video player gets, so its controls still fit over it. */
const VIDEO_MIN_W = 320;
const VIDEO_MIN_H = 180;

/**
 * The size a picture or video is shown at in a message. Links to media use it
 * too, so a GIF from the picker sits in the same frame as an uploaded one.
 */
export function fitMedia(w: number | undefined, h: number | undefined): { width: number; height: number } {
  if (!w || !h) return { width: 400, height: 300 };
  let r = Math.min(1, MAX_W / w, MAX_H / h);
  if (w * r < 100 && h * r < 100) r = Math.min(100 / w, 100 / h, MAX_W / w, MAX_H / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

/**
 * The frame a video plays in. It follows the video's shape, but is never so
 * narrow or short that the controls spill over its edges; the video is fitted
 * inside it, with black at the sides or top and bottom when the shapes differ.
 */
export function fitVideo(w: number, h: number): { width: number; height: number } {
  const fit = fitMedia(w, h);
  const width = Math.max(fit.width, VIDEO_MIN_W);
  const height = Math.min(MAX_H, Math.max(VIDEO_MIN_H, fit.height, Math.round((width * h) / w)));
  return { width, height };
}
