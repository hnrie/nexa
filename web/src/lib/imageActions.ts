import { pickSaveFile, saveBlob } from "./saveFile";

import { t } from "@/i18n";/**
 * Copying a picture to the clipboard and saving it, for the right-click menu
 * on pictures in chats and in the picture viewer.
 */

/**
 * A picture a menu was opened on: where its image is, and what to call it
 * when saved. `full` fetches the picture itself where what shows is its small
 * copy (lib/pictureCopy.ts), which copying and saving must not hand over.
 */
export interface ImageTarget {
  src: string;
  name: string;
  full?: () => Promise<string>;
}

/** Pictures on screen that show a small copy, and how to get the picture itself. */
const fullSources = new WeakMap<Element, () => Promise<string>>();

/** Says how to get the picture a copy on screen stands for; null when it shows the picture itself. */
export function setFullSource(el: Element, load: (() => Promise<string>) | null): void {
  if (load) fullSources.set(el, load);
  else fullSources.delete(el);
}

/**
 * The picture under a right click or long press, if there is one. Pictures
 * that offer these actions carry `data-image-src` (and `data-image-name`); a
 * picture still under its spoiler cover is not one of them, since the cover
 * takes the click.
 */
export function imageTarget(target: EventTarget | null): ImageTarget | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-image-src]");
  const src = el?.dataset["imageSrc"];
  if (!el || !src) return null;
  const full = fullSources.get(el);
  return { src, name: el.dataset["imageName"] || "image", ...(full ? { full } : {}) };
}

/**
 * A file name for a picture's address. A picture shown through this server's
 * media proxy carries its original address, base64url-encoded, at the end of
 * the path, and that is where its name is.
 */
export function imageNameFromUrl(url: string, fallback = "image"): string {
  try {
    const u = new URL(url, typeof location === "undefined" ? "http://localhost" : location.href);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "media" && parts[1] === "proxy" && parts[3]) {
      const b64 = parts[3].replace(/-/g, "+").replace(/_/g, "/");
      return imageNameFromUrl(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), fallback);
    }
    const last = parts.pop();
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}

/** Browsers refuse to draw bigger canvases (Safari stops at 16 megapixels); a larger picture is copied scaled to fit. */
const MAX_PIXELS = 16_777_216;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/apng": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/** A file name that ends in the picture's own extension. */
export function withExtension(name: string, type: string): string {
  const base = name.trim() || "image";
  const ext = EXTENSIONS[type.toLowerCase().split(";")[0]!.trim()];
  if (!ext || /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  return `${base}.${ext}`;
}

/**
 * The picture as a PNG, the one image type every browser's clipboard takes;
 * animations keep their first frame. Drawing from an image element also
 * handles decrypted attachments at blob: addresses.
 */
async function toPng(src: string): Promise<Blob> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const w0 = img.naturalWidth || 1;
  const h0 = img.naturalHeight || 1;
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w0 * h0)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(w0 * scale));
  canvas.height = Math.max(1, Math.floor(h0 * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("imageActions.thePictureCouldNotBeCopied"));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("imageActions.thePictureCouldNotBeCopied")))), "image/png"));
}

/**
 * Puts the picture on the clipboard. Safari only lets a page write to the
 * clipboard during the click itself, so the clipboard item is made at once
 * and handed the picture when it is ready (a picture shown from its copy may
 * still have to be fetched whole).
 */
export function copyImage(src: string | Promise<string>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.reject(new Error(t("imageActions.thisBrowserCanTCopyPictures")));
  }
  return navigator.clipboard.write([new ClipboardItem({ "image/png": Promise.resolve(src).then(toPng) })]);
}

/**
 * Saves the picture as a file, named after it with its own extension. A
 * decrypted attachment already is a file in the page (and carries its name);
 * anything else is fetched first to learn what kind of picture it is.
 */
export async function saveImage(src: string | (() => Promise<string>), name: string): Promise<void> {
  const handle = await pickSaveFile(name);
  if (handle === null) return;
  const url = typeof src === "function" ? await src() : src;
  const res = await fetch(url);
  if (!res.ok) throw new Error(t("imageActions.thePictureCouldNotBeLoaded"));
  const blob = await res.blob();
  await saveBlob(blob, withExtension(name, blob.type), handle);
}
