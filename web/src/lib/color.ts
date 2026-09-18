/**
 * Colour maths for the user-chosen accent.
 *
 * The measure here is WCAG 2.x relative luminance and the (L1 + 0.05) /
 * (L2 + 0.05) contrast ratio, not APCA. Two reasons: every contrast number in
 * this project's design notes, and every number an operator will be handed by
 * axe or Lighthouse, is a WCAG 2.x ratio, so a different yardstick here would
 * report "fine" for something a checker still fails; and the AA floor of 4.5:1
 * for body text is what the rest of the palette was built against. WCAG 2.x is
 * known to over-weight blue and to misjudge some dark-on-dark pairs, but the
 * decision made below — black or white, whichever is further away — is the same
 * one either model reaches for all but a sliver of colours.
 */

export type Rgb = [number, number, number];

const AA_TEXT = 4.5;
/** The near-black the tooltip uses; softer on a fill than pure black. */
const SOFT_BLACK = "#111214";

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** WCAG 2.x relative luminance, 0 for black and 1 for white. */
export function luminance(colour: string | Rgb): number {
  const rgb = typeof colour === "string" ? parseHex(colour) : colour;
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What `a` looks like at `alpha` over `b` — the flat colour a screen shows. */
export function blend(a: string | Rgb, b: string | Rgb, alpha: number): Rgb {
  const x = (typeof a === "string" ? parseHex(a) : a) ?? [0, 0, 0];
  const y = (typeof b === "string" ? parseHex(b) : b) ?? [0, 0, 0];
  return [0, 1, 2].map((i) => x[i]! * alpha + y[i]! * (1 - alpha)) as Rgb;
}

/** The same colour as a CSS value carrying an alpha channel. */
export function withAlpha(colour: string, alpha: number): string {
  const rgb = parseHex(colour);
  if (!rgb) return colour;
  return `rgb(${rgb.map((v) => Math.round(v)).join(" ")} / ${alpha})`;
}

export function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const [r, g, b] = rgb.map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [(r! + m) * 255, (g! + m) * 255, (b! + m) * 255] as Rgb;
}

/** The same hue and saturation, `delta` further up or down the lightness scale. */
export function shade(colour: string, delta: number): string {
  const rgb = parseHex(colour);
  if (!rgb) return colour;
  const { h, s, l } = rgbToHsl(rgb);
  return toHex(hslToRgb(h, s, Math.min(1, Math.max(0, l + delta))));
}

/**
 * The text colour to print on a fill of `background`.
 *
 * Picking whichever of black and white is further from the fill is not a
 * heuristic: because contrast depends only on luminance, the worse of the two
 * choices is at its best when they are equal, and there the winner still reads
 * at 4.58:1. So any colour at all — a preset, or whatever the free picker
 * returns — gets a foreground that clears AA for body text. Pure black is only
 * reached for when the softer near-black would not, which is a thin band
 * around the crossover.
 */
export function readableOn(background: string): string {
  const white = contrast(background, "#ffffff");
  const black = contrast(background, "#000000");
  if (white >= black) return "#ffffff";
  return contrast(background, SOFT_BLACK) >= AA_TEXT ? SOFT_BLACK : "#000000";
}

/**
 * `colour` moved along its own lightness until it reads at `target` against
 * `background`, keeping its hue. Tries the direction away from the background
 * first; if the colour runs out of room it comes back the other way, and if
 * neither side can reach the target it returns the best it found.
 */
export function tuneForContrast(colour: string, background: string, target: number): string {
  if (contrast(colour, background) >= target) return colour;
  const rgb = parseHex(colour);
  if (!rgb) return colour;
  const { h, s, l } = rgbToHsl(rgb);
  const away = luminance(background) > 0.5 ? -1 : 1;
  let best = colour;
  let bestRatio = contrast(colour, background);
  for (const dir of [away, -away]) {
    for (let step = 1; step <= 100; step++) {
      const candidate = toHex(hslToRgb(h, s, Math.min(1, Math.max(0, l + dir * step * 0.01))));
      const ratio = contrast(candidate, background);
      if (ratio > bestRatio) {
        best = candidate;
        bestRatio = ratio;
      }
      if (ratio >= target) return candidate;
    }
  }
  return best;
}
