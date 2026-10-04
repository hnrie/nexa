import { useEffect, useState } from "react";

/**
 * The colour a picture is mostly made of, as #rrggbb: pixels are grouped
 * into coarse buckets and the fullest bucket wins, with colourful pixels
 * counting for more than grey ones, so a logo on a white or black ground
 * gives the logo's colour and not the ground's. Transparent pixels do not
 * count. Null when nothing is left to count.
 *
 * `data` is RGBA, as a canvas's getImageData gives it.
 */
export function dominantColor(data: ArrayLike<number>): string | null {
  const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (data[i + 3]! < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // how colourful, 0 for grey; near-black and near-white count a little, never nothing
    const chroma = (max - min) / 255;
    const weight = 0.15 + chroma;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    cur.weight += weight;
    cur.r += r * weight;
    cur.g += g * weight;
    cur.b += b * weight;
    buckets.set(key, cur);
  }
  let best: { weight: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!best || v.weight > best.weight) best = v;
  if (!best) return null;
  const hex = (n: number) => Math.round(n / best!.weight).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

const known = new Map<string, string | null>();
/** How many pictures' colours are remembered: the oldest go first, so scrolling past thousands of them stays light. */
const KNOWN_MAX = 500;

function remember(url: string, color: string | null): void {
  known.delete(url);
  known.set(url, color);
  while (known.size > KNOWN_MAX) known.delete(known.keys().next().value as string);
}

/**
 * The main colour of a picture at `url`, once it has loaded; null until
 * then, and for a picture that cannot be read. Only for Nexa's own
 * pictures, which the page may read back: another site's would taint the
 * canvas.
 */
export function useDominantColor(url: string | null): string | null {
  const [color, setColor] = useState<string | null>(() => (url ? (known.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) {
      setColor(null);
      return;
    }
    if (known.has(url)) {
      setColor(known.get(url) ?? null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      let found: string | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, 24, 24);
          found = dominantColor(ctx.getImageData(0, 0, 24, 24).data);
        }
      } catch {
        /* a picture the page may not read: the default colour stays */
      }
      remember(url, found);
      if (alive) setColor(found);
    };
    img.onerror = () => {
      remember(url, null);
      if (alive) setColor(null);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return color;
}
