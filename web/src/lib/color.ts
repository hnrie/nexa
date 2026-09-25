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
 * A colour as a value a theme can hold: six-digit hex, or eight when it is
 * partly see-through. Also takes three- and four-digit hex and CSS rgb()/rgba()
 * in either syntax, which is what themes written elsewhere tend to use.
 */
export function parseColour(value: string): { rgb: Rgb; alpha: number } | null {
  const v = value.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    const raw = m[1]!.length <= 4 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
    const n = (i: number) => parseInt(raw.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: raw.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return null;
  const ch = [m[1], m[2], m[3]].map(Number);
  if (ch.some((x) => !Number.isFinite(x) || x > 255)) return null;
  let alpha = 1;
  if (m[4] !== undefined) alpha = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return { rgb: ch as Rgb, alpha };
}

/** A colour and its alpha written the way a theme stores them: #rrggbb, or #rrggbbaa below full strength. */
export function toThemeHex(rgb: Rgb, alpha = 1): string {
  const hex = toHex(rgb);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a >= 255 ? hex : hex + a.toString(16).padStart(2, "0");
}

/** What a possibly see-through colour looks like drawn over an opaque one. */
export function flatten(value: string, over: string): string {
  const c = parseColour(value);
  const bg = parseColour(over);
  if (!c) return over;
  if (c.alpha >= 1 || !bg) return toHex(c.rgb);
  return toHex(blend(c.rgb, bg.rgb, c.alpha));
}

/*
 * OKLCH, for moving a colour lighter or darker without it changing character.
 * HSL lightness is not how bright a colour looks: a yellow and a blue of the
 * same HSL lightness are nothing alike, so steps taken in it land unevenly.
 * These are Björn Ottosson's published matrices.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** The sRGB colour for an OKLCH one, unclamped: a channel outside 0–255 means the screen cannot show it. */
function oklchToRawRgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l3 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m3 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s3 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    fromLinear(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    fromLinear(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -0.5 && v <= 255.5);

/**
 * The OKLCH colour as hex, giving up chroma rather than hue or lightness when
 * the screen cannot show it: a saturated colour pushed very light or very dark
 * comes out paler, not a different colour.
 */
export function oklchToHex(o: Oklch): string {
  const l = Math.min(1, Math.max(0, o.l));
  let rgb = oklchToRawRgb({ l, c: o.c, h: o.h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = o.c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRawRgb({ l, c: mid, h: o.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToRawRgb({ l, c: lo, h: o.h });
  }
  return toHex(rgb);
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToOklch(rgb) : null;
}

/**
 * The colour with the same hue and chroma whose relative luminance is `target`
 * (0 to 1). Contrast is a function of luminance alone, so this is how a
 * surface is placed a given ratio away from another one.
 */
export function withLuminance(colour: string, target: number, side: "nearest" | "atLeast" | "atMost" = "nearest"): string {
  const o = hexToOklch(colour);
  if (!o) return colour;
  const want = Math.min(1, Math.max(0, target));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(oklchToHex({ ...o, l: mid })) < want) lo = mid;
    else hi = mid;
  }
  // hex has only so many steps: say which side of the target the answer may land on
  if (side === "atLeast") return oklchToHex({ ...o, l: hi });
  if (side === "atMost") return oklchToHex({ ...o, l: lo });
  return oklchToHex({ ...o, l: (lo + hi) / 2 });
}

/** The lowest contrast `colour` makes against any of `backgrounds`. */
export function worstContrast(colour: string, backgrounds: string[]): number {
  return backgrounds.reduce((worst, bg) => Math.min(worst, contrast(colour, bg)), 21);
}

/**
 * `colour` made lighter or darker, keeping its hue, until it reads at `target`
 * against every one of `backgrounds`; unchanged when it already does. It moves
 * away from the backgrounds (lighter on dark ones, darker on light ones) in the
 * smallest steps that get there, and if even black or white falls short it
 * returns whichever of the two does best.
 */
export function ensureContrast(colour: string, backgrounds: string[], target: number): string {
  if (!parseHex(colour) || backgrounds.length === 0) return colour;
  if (worstContrast(colour, backgrounds) >= target) return colour;
  const o = hexToOklch(colour)!;
  const lightest = Math.max(...backgrounds.map((b) => luminance(b)));
  const darkest = Math.min(...backgrounds.map((b) => luminance(b)));
  // Which way has more room: text on dark surfaces goes lighter, on light ones darker.
  const up = (1.05 / (lightest + 0.05)) >= ((darkest + 0.05) / 0.05);
  const edge = up ? 1 : 0;
  if (worstContrast(oklchToHex({ ...o, l: edge }), backgrounds) < target) {
    const white = worstContrast("#ffffff", backgrounds);
    const black = worstContrast("#000000", backgrounds);
    return white >= black ? "#ffffff" : "#000000";
  }
  let near = o.l;
  let far = edge;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (worstContrast(oklchToHex({ ...o, l: mid }), backgrounds) >= target) far = mid;
    else near = mid;
  }
  return oklchToHex({ ...o, l: far });
}

/** `a` moved `amount` of the way towards `b` in OKLab, where halfway looks halfway. */
export function mixOk(a: string, b: string, amount: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  const toLab = (rgb: Rgb) => {
    const o = rgbToOklch(rgb);
    const hr = (o.h * Math.PI) / 180;
    return [o.l, o.c * Math.cos(hr), o.c * Math.sin(hr)] as const;
  };
  const p = toLab(x);
  const q = toLab(y);
  const L = p[0] + (q[0] - p[0]) * amount;
  const A = p[1] + (q[1] - p[1]) * amount;
  const B = p[2] + (q[2] - p[2]) * amount;
  return oklchToHex({ l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 });
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
