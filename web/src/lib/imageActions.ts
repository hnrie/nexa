
import { t } from "@/i18n";/**
 * Copying a picture to the clipboard and saving it, for the right-click menu
 * on pictures in chats and in the picture viewer.
 */

/** A picture a menu was opened on: where its full-size image is, and what to call it when saved. */
export interface ImageTarget {
  src: string;
  name: string;
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
  return { src, name: el.dataset["imageName"] || "image" };
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
 * animations keep their first frame. It is drawn from an image element rather
 * than fetched: a decrypted attachment is a blob: address, which the page's
 * content security policy lets it show but not fetch.
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

function download(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Puts the picture on the clipboard. Safari only lets a page write to the
 * clipboard during the click itself, so the clipboard item is made at once
 * and handed the picture when it is ready.
 */
export function copyImage(src: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.reject(new Error(t("imageActions.thisBrowserCanTCopyPictures")));
  }
  return navigator.clipboard.write([new ClipboardItem({ "image/png": toPng(src) })]);
}

/**
 * Saves the picture as a file, named after it with its own extension. A
 * decrypted attachment already is a file in the page (and carries its name);
 * anything else is fetched first to learn what kind of picture it is.
 */
export async function saveImage(src: string, name: string): Promise<void> {
  if (src.startsWith("blob:")) {
    download(src, name.trim() || "image");
    return;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(t("imageActions.thePictureCouldNotBeLoaded"));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  download(url, withExtension(name, blob.type));
  // the browser has its own hold on the file by the time this runs out
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
