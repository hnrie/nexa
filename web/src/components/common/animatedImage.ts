/** How much of the file is read to find out; the markers sit near the start. */
const HEAD = 64 * 1024;

/** Types that are taken as animated without looking inside. */
export function animatedByType(type: string): boolean {
  return type === "image/gif" || type === "image/apng";
}

function tag(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
}

/**
 * Whether the start of a file says it animates. Most WebP and PNG pictures
 * are still, and those should be cropped like any other.
 */
export function animatedBytes(type: string, b: Uint8Array): boolean {
  if (animatedByType(type)) return true;
  if (type === "image/webp") {
    // an extended WebP (VP8X) marks animation with bit 0x02 of its flags
    return tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP" && tag(b, 12) === "VP8X" && ((b[20] ?? 0) & 0x02) !== 0;
  }
  if (type === "image/png") {
    // an animated PNG has an acTL chunk before its first image data
    if (tag(b, 0) !== "\x89PNG") return false;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = 8;
    while (at + 8 <= b.length) {
      const kind = tag(b, at + 4);
      if (kind === "acTL") return true;
      if (kind === "IDAT" || kind === "IEND") return false;
      at += 12 + view.getUint32(at);
    }
  }
  return false;
}

/** Whether the picture animates, from its type and the first bytes of the file. */
export async function isAnimatedImage(file: Blob): Promise<boolean> {
  if (animatedByType(file.type)) return true;
  if (file.type !== "image/webp" && file.type !== "image/png") return false;
  try {
    return animatedBytes(file.type, new Uint8Array(await file.slice(0, HEAD).arrayBuffer()));
  } catch {
    return false;
  }
}
