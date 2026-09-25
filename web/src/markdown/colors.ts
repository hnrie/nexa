import { blend, contrast, luminance, parseHex, readableOn, toHex, tuneForContrast, type Rgb } from "@/lib/color";

// ---------------------------------------------------------------------------
// Coloured text: `[words]{red}`, `[words]{#ff8800}`, `[words]{on yellow}`,
// `[words]{red on yellow}`.
//
// The syntax borrows the bracketed span of Pandoc and Djot. It reads as it is
// meant where it is not drawn (the words first, the colour after them, like a
// note in the margin), it cannot happen by accident because the braces must
// hold a colour this list knows, and it sits next to [masked](links), which
// people already type.
//
// Whatever colour is asked for, what is painted is measured against the
// surface under it: a named colour takes the shade made for that kind of
// background, and anything that would still read at under 4.5:1 is moved
// along its own lightness until it does. Pale yellow on a white theme and
// navy on black both come out readable, and an author's hex code can never
// make words disappear.
// ---------------------------------------------------------------------------

/** The palette, in the order the formatting editor offers it. */
export const COLOR_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "purple", "pink", "brown", "gray"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/**
 * Each name's shade for dark surfaces and for light ones. Both read at 4.6:1
 * or better on every panel of every built-in theme (the dark shades on dark,
 * ash and onyx, the light ones on light) before any tuning.
 */
export const PALETTE: Readonly<Record<ColorName, { dark: string; light: string }>> = {
  red: { dark: "#ff8077", light: "#cb212d" },
  orange: { dark: "#ffa657", light: "#b24800" },
  yellow: { dark: "#e3b341", light: "#8a6100" },
  lime: { dark: "#a5d63f", light: "#4a7500" },
  green: { dark: "#56d364", light: "#197934" },
  teal: { dark: "#39c5bb", light: "#0f766e" },
  cyan: { dark: "#56d4f5", light: "#0a6f8f" },
  blue: { dark: "#79c0ff", light: "#0965d3" },
  purple: { dark: "#d2a8ff", light: "#7c47dd" },
  pink: { dark: "#ff9bce", light: "#b53682" },
  brown: { dark: "#d4a373", light: "#8b5a2b" },
  gray: { dark: "#b1bac4", light: "#59636e" },
};

const NAMES = new Set<string>(COLOR_NAMES);

/** Body text contrast, WCAG AA. */
const READABLE = 4.5;
/** How strongly a highlight's colour shows over the surface. */
const TINT = 0.5;

export interface ColorSpec {
  fg: string | null;
  bg: string | null;
}

/** A palette name ("grey" is "gray") or a #rgb / #rrggbb code, normalised; null for anything else. */
export function colorToken(word: string): string | null {
  const w = word.toLowerCase();
  if (w === "grey") return "gray";
  if (NAMES.has(w)) return w;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(w);
  if (!m) return null;
  const hex = m[1]!;
  return "#" + (hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex);
}

/**
 * What the braces of `[words]{…}` ask for: `red`, `#f80`, `on yellow` or
 * `red on yellow`. Anything else is not a colour, and the text stays as typed.
 */
export function parseColorSpec(raw: string): ColorSpec | null {
  const words = raw.trim().toLowerCase().split(/\s+/);
  if (words.length === 1) {
    const fg = colorToken(words[0] ?? "");
    return fg ? { fg, bg: null } : null;
  }
  if (words.length === 2 && words[0] === "on") {
    const bg = colorToken(words[1] ?? "");
    return bg ? { fg: null, bg } : null;
  }
  if (words.length === 3 && words[1] === "on") {
    const fg = colorToken(words[0] ?? "");
    const bg = colorToken(words[2] ?? "");
    return fg && bg ? { fg, bg } : null;
  }
  return null;
}

/** The braces' contents for a spec, as the formatting editor writes them. */
export function formatColorSpec(spec: ColorSpec): string {
  if (spec.fg && spec.bg) return `${spec.fg} on ${spec.bg}`;
  if (spec.bg) return `on ${spec.bg}`;
  return spec.fg ?? "";
}

function isLight(surface: Rgb): boolean {
  return luminance(surface) > 0.4;
}

/** The colour a token starts from on this surface: a name's shade for it, or the code as written. */
function base(token: string, surface: Rgb): string {
  const named = PALETTE[token as ColorName];
  if (named) return isLight(surface) ? named.light : named.dark;
  return token;
}

/** What surrounds a coloured run: the background it sits on and the text colour it would otherwise have. */
export interface Surface {
  bg: Rgb;
  text: Rgb;
}

/** The dark theme's message background and text, for when nothing can be measured (tests, a detached node). */
export const FALLBACK_SURFACE: Surface = { bg: [0x2c, 0x2d, 0x32], text: [0xf3, 0xf3, 0xf4] };

/**
 * The colours to paint a run with on this surface: its text colour, and its
 * highlight fill when it has one. Every pair that comes out reads at 4.5:1.
 */
export function paintColor(spec: ColorSpec, surface: Surface): { color: string | null; background: string | null } {
  const page = toHex(surface.bg);
  if (!spec.bg) {
    return { color: spec.fg ? tuneForContrast(base(spec.fg, surface.bg), page, READABLE) : null, background: null };
  }
  // A highlight is a tint of the chosen colour over the page: the deeper shade
  // on a dark page and the paler one on a light page, so it stays a highlight
  // rather than a slab.
  const fillFrom = PALETTE[spec.bg as ColorName];
  const fill = fillFrom ? (isLight(surface.bg) ? fillFrom.dark : fillFrom.light) : spec.bg;
  const tint = toHex(blend(fill, surface.bg, TINT));
  let color: string | null;
  if (spec.fg) color = tuneForContrast(base(spec.fg, parseHex(tint) ?? surface.bg), tint, READABLE);
  else color = contrast(surface.text, tint) >= READABLE ? null : readableOn(tint);
  return { color, background: tint };
}

/** A swatch's colour for the editor's palette: the name as it will be painted here. */
export function swatchColor(token: string, surface: Surface): string {
  return paintColor({ fg: token, bg: null }, surface).color ?? toHex(surface.text);
}

// ---------------------------------------------------------------------------
// reading the surface off the page
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

const RE_RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
const RE_SRGB = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;

function alphaOf(raw: string | undefined): number {
  if (raw === undefined) return 1;
  return raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
}

const parsed = new Map<string, Rgba | null>();
let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour as the four numbers a screen draws. Computed styles come back
 * as rgb(), rgba() or, for color-mix(), color(srgb …); anything else a custom
 * theme might hold (oklch, a named colour) is drawn once on a 1×1 canvas and
 * read back.
 */
export function cssColor(value: string): Rgba | null {
  const v = value.trim();
  if (v === "" || v === "transparent") return v === "transparent" ? [0, 0, 0, 0] : null;
  const hit = parsed.get(v);
  if (hit !== undefined) return hit;
  let out: Rgba | null = null;
  const hex = parseHex(v);
  let m: RegExpExecArray | null;
  if (hex && v.startsWith("#")) out = [...hex, 1];
  else if ((m = RE_RGB.exec(v))) out = [Number(m[1]), Number(m[2]), Number(m[3]), alphaOf(m[4])];
  else if ((m = RE_SRGB.exec(v))) out = [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, alphaOf(m[4])];
  else out = drawn(v);
  if (parsed.size > 256) parsed.clear();
  parsed.set(v, out);
  return out;
}

function drawn(value: string): Rgba | null {
  if (probe === undefined) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext("2d", { willReadFrequently: true }) ?? null;
    } catch {
      probe = null;
    }
  }
  if (!probe) return null;
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0, (a ?? 255) / 255];
  } catch {
    return null;
  }
}

/** The theme's message background and text colour, from its custom properties. */
export function themeSurface(): Surface {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return FALLBACK_SURFACE;
  const root = getComputedStyle(document.documentElement);
  const bg = cssColor(root.getPropertyValue("--bg-base"));
  const text = cssColor(root.getPropertyValue("--text"));
  if (!bg || bg[3] < 0.5) return FALLBACK_SURFACE;
  return { bg: [bg[0], bg[1], bg[2]], text: text ? [text[0], text[1], text[2]] : FALLBACK_SURFACE.text };
}

/**
 * The surface an element is drawn on: the backgrounds from it up to the first
 * opaque one, see-through layers composited over it the way the screen does,
 * and the text colour it inherits. A message sits on the chat, a highlighted
 * mention's tint, a callout's tint or a profile card, and each is measured as
 * it is; with nothing opaque above it, the theme's background stands in.
 */
export function surfaceOf(el: Element): Surface {
  if (typeof getComputedStyle !== "function") return FALLBACK_SURFACE;
  const layers: Rgba[] = [];
  let bg: Rgb | null = null;
  let node: Element | null = el;
  for (let hops = 0; node && hops < 40; hops++, node = node.parentElement) {
    const c = cssColor(getComputedStyle(node).backgroundColor);
    if (!c || c[3] <= 0.01) continue;
    if (c[3] >= 0.99) {
      bg = [c[0], c[1], c[2]];
      break;
    }
    layers.push(c);
  }
  let out: Rgb = bg ?? themeSurface().bg;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    out = blend([l[0], l[1], l[2]], out, l[3]);
  }
  const text = cssColor(getComputedStyle(el).color);
  return { bg: out, text: text && text[3] > 0.5 ? [text[0], text[1], text[2]] : themeSurface().text };
}

// ---------------------------------------------------------------------------
// following the theme
// ---------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();
let watching: MutationObserver | null = null;
let frame = 0;

function bump(): void {
  frame = 0;
  version += 1;
  for (const fn of [...listeners]) fn();
}

/**
 * Tells colour runs to measure again when the theme may have changed: the
 * root's theme attribute or inline custom properties, or a stylesheet added
 * to or taken from the head (a custom theme). One observer serves the page.
 */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  if (!watching && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    watching = new MutationObserver(() => {
      if (!frame) frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(bump) : (setTimeout(bump, 16) as unknown as number);
    });
    watching.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    if (document.head) watching.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && watching) {
      watching.disconnect();
      watching = null;
    }
  };
}

export function themeVersion(): number {
  return version;
}
