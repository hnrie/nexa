/**
 * Looks at a picture that is about to be sent: how big it is, and a small
 * copy of it for the chat to show (see lib/pictureCopy.ts).
 *
 * Decoding a phone's photo takes tens of milliseconds and tens of megabytes,
 * and shrinking and encoding the copy as long again. Done here it holds up
 * nothing on the page, and ending the worker afterwards gives all of that
 * memory back at once.
 */

export interface PictureRequest {
  file: Blob;
  /** Whether to make the small copy too, or only measure. */
  copy: boolean;
  /** The longest side the copy may have. */
  side: number;
}

export interface PictureCopy {
  blob: Blob;
  type: string;
  w: number;
  h: number;
}

export interface PictureReply {
  w?: number;
  h?: number;
  copy?: PictureCopy;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<PictureRequest>) => void) | null;
  postMessage(msg: PictureReply): void;
}

const scope = self as unknown as WorkerScope;

/** Whether every pixel is solid, so the copy can be a JPEG without losing anything. */
function opaque(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
  return true;
}

async function smallCopy(bmp: ImageBitmap, sourceType: string, side: number): Promise<PictureCopy | null> {
  const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  if (blob.type !== "image/webp") {
    // Safari cannot write WebP. A JPEG has no transparency, so only a picture
    // with none goes that way; one with some keeps only its full size.
    if (sourceType !== "image/jpeg" && !opaque(ctx, w, h)) return null;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    if (blob.type !== "image/jpeg") return null;
  }
  return { blob, type: blob.type, w, h };
}

scope.onmessage = (e) => {
  const job = e.data;
  void (async () => {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(job.file);
    } catch {
      // not a picture this browser can open (HEIC outside Safari, a broken file)
      scope.postMessage({});
      return;
    }
    const reply: PictureReply = { w: bmp.width, h: bmp.height };
    if (job.copy) {
      try {
        const copy = await smallCopy(bmp, job.file.type, job.side);
        if (copy) reply.copy = copy;
      } catch {
        // the picture goes at its full size alone
      }
    }
    bmp.close();
    scope.postMessage(reply);
  })();
};
