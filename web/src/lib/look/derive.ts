import { ensureContrast, flatten, hexToOklch, luminance, mixOk, oklchToHex, parseColour, readableOn, toHex, toThemeHex, withLuminance } from "@/lib/color";
import type { TokenMap } from "./tokens";
import type { Scheme, SimpleColours } from "./types";

/**
 * A whole theme from a few colours.
 *
 * The theme builder's simple mode and every colour preset in the gallery come
 * out of this one function, so the promise is made once: whatever colours go
 * in, every piece of text that comes out reads at WCAG AA (4.5:1) on every
 * surface it is drawn on, including a row lit up under the pointer, a mention
 * and a code block. Colours are moved rather than refused: the background
 * into the range its scheme needs, the text and every shade of it lighter or
 * darker until it reads, the accent until buttons stand out from the page.
 * Surfaces are placed by contrast ratio rather than by a fixed step, so a
 * near-black background still gets panels that can be told apart.
 */

export interface DeriveOptions {
  /** Stronger text, borders and focus: the high contrast themes. */
  contrast?: "normal" | "high";
}

export interface Derived {
  tokens: TokenMap;
  scheme: Scheme;
  /** The background as it was used: moved into the scheme's range when it was outside it. */
  background: string;
  /** What had to be moved to keep everything readable, so the builder can say so. */
  adjusted: { background: boolean; accent: boolean; text: boolean };
}

/**
 * How light the main background may be in each scheme, as relative luminance.
 * A dark one past 0.07 or a light one under 0.6 leaves too little room
 * between it and the text for the muted shades to stay readable.
 */
export const BACKGROUND_RANGE: Record<Scheme, [number, number]> = { dark: [0, 0.07], light: [0.6, 1] };
/** High contrast keeps its backgrounds near black or white, where the brightest overlays still leave the text at 7:1. */
const HIGH_RANGE: Record<Scheme, [number, number]> = { dark: [0, 0.02], light: [0.8, 1] };

/** Where a background lands when it is carried over to the other scheme. */
const FLIP_TO: Record<Scheme, number> = { dark: 0.03, light: 0.93 };

/** The scheme a background belongs to: the side of the middle grey it is on. */
export function schemeOf(background: string): Scheme {
  return luminance(background) > 0.18 ? "light" : "dark";
}

/** The background moved just far enough to sit in its scheme's range, keeping its hue. */
export function fitBackground(background: string, scheme: Scheme, high = false): string {
  const c = parseColour(background);
  const hex = c ? toHex(c.rgb) : "#000000";
  const y = luminance(hex);
  const [lo, hi] = (high ? HIGH_RANGE : BACKGROUND_RANGE)[scheme];
  if (y >= lo && y <= hi) return hex;
  return y < lo ? withLuminance(hex, lo, "atLeast") : withLuminance(hex, hi, "atMost");
}

/** The same background in the other scheme: its hue and tint at the lightness that scheme's backgrounds have. */
export function flipBackground(background: string, scheme: Scheme): string {
  const c = parseColour(background);
  return withLuminance(c ? toHex(c.rgb) : "#000000", FLIP_TO[scheme]);
}

/** A colour placed `ratio` away from `from` in contrast, keeping its hue; above 1 is lighter, below is darker. */
function stepFrom(from: string, ratio: number): string {
  const y = luminance(from);
  return withLuminance(from, Math.min(1, Math.max(0, (y + 0.05) * ratio - 0.05)));
}

/** Moves a fill's lightness by `delta` (OKLCH), backing off for as long as that would cost `fg` its contrast on it. */
function shadeKeeping(fill: string, fg: string, delta: number, target = 4.5): string {
  const o = hexToOklch(fill);
  if (!o) return fill;
  for (let i = 10; i > 0; i--) {
    const out = oklchToHex({ ...o, l: o.l + (delta * i) / 10 });
    if (contrastOf(out, fg) >= target) return out;
  }
  return fill;
}

function contrastOf(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A fill that carries white text (danger, positive): darkened until the text reads, with a darker hover. */
function whiteTextFill(colour: string): { fill: string; hover: string } {
  const fill = ensureContrast(colour, ["#ffffff"], 4.6);
  const o = hexToOklch(fill)!;
  return { fill, hover: oklchToHex({ ...o, l: Math.max(0, o.l - 0.07) }) };
}

const SOFT_BLACK = "#111214";

/**
 * The accent's family: the fill, what goes on it, its hover and pressed
 * shades, the ring, the mention pill and the accent as text. `surfaces` are
 * what those are read against; `page` what a button has to stand out from.
 */
export function brandTokens(accent: string, scheme: Scheme, surfaces: string[], raised: string, opts: { high?: boolean; keepAccent?: boolean; page?: string[] } = {}): Pick<TokenMap, "brand" | "brand-hover" | "brand-active" | "on-brand" | "text-brand" | "focus-ring" | "mention-bg" | "mention-bg-hover" | "mention-fg"> {
  const picked = parseColour(accent);
  let brand = picked ? toHex(picked.rgb) : "#8000ff";
  // A button the colour of the page it sits on is a label floating in space.
  if (!opts.keepAccent && opts.page?.length) brand = ensureContrast(brand, opts.page, opts.high ? 3 : 2);
  const fg = readableOn(brand);
  // Hover darkens, as it always has, unless the fill is already so dark that
  // there is nothing left to see below it; those brighten instead.
  const dir = (hexToOklch(brand)?.l ?? 0.5) > 0.32 ? -1 : 1;
  const hover = shadeKeeping(brand, fg, dir * 0.06);
  const active = shadeKeeping(brand, fg, dir * 0.11);
  const rgb = parseColour(brand)!.rgb;
  // A message that mentions you is lit up in the accent, and its text has to
  // read on that. A pale accent in a dark theme (or a dark one in a light
  // theme) would light it up too far, so the tint is thinned until it does not.
  const bound = scheme === "dark" ? Math.max(0.1, luminance(raised)) : Math.min(0.5, luminance(raised));
  const thin = (alpha: number): number => {
    let a = alpha;
    const past = (x: number) => {
      const y = luminance(flatten(toThemeHex(rgb, x), raised));
      return scheme === "dark" ? y > bound : y < bound;
    };
    while (a > 0.06 && past(a)) a -= 0.02;
    return Math.round(a * 100) / 100;
  };
  const [rest, hovered] = scheme === "light" ? [thin(0.16), thin(0.32)] : [thin(0.26), thin(0.42)];
  const pill = toThemeHex(rgb, hovered);
  const pillRest = toThemeHex(rgb, rest);
  const pills = [flatten(pill, raised), flatten(pillRest, raised), ...surfaces.map((s) => flatten(pill, s))];
  return {
    brand,
    "brand-hover": hover,
    "brand-active": active,
    "on-brand": fg,
    "text-brand": ensureContrast(brand, surfaces, opts.high ? 7 : 4.5),
    "focus-ring": ensureContrast(brand, surfaces, opts.high ? 4.5 : 3),
    "mention-bg": pillRest,
    "mention-bg-hover": pill,
    "mention-fg": ensureContrast(brand, pills, opts.high ? 7 : 4.5),
  };
}

export function deriveTheme(input: SimpleColours, opts: DeriveOptions = {}): Derived {
  const high = opts.contrast === "high";
  const scheme = input.scheme;
  const dark = scheme === "dark";
  const pickedBg = parseColour(input.background);
  const raised = fitBackground(input.background, scheme, high);
  const o = hexToOklch(raised)!;
  const tint = (l: number, cMax = 0.025) => oklchToHex({ l, c: Math.min(o.c, cMax), h: o.h });

  // The panels, placed by contrast from the main background: the sidebar a
  // step darker in either scheme, cards and inputs a step the other way, as
  // the classic themes have them. Below black a step comes back up instead.
  const base = stepFrom(raised, dark ? 1 / 1.08 : 1 / 1.1);
  const surface = stepFrom(raised, dark ? 1.1 : 1 / 1.19);
  const floating = dark ? stepFrom(raised, 1.045) : stepFrom(raised, 1.06);
  // Inputs are wells, a step below the page. On a page that is black
  // already there is no below, so they are lifted a little off it instead.
  const y = luminance(raised);
  const input_ = !dark ? surface : y < 0.005 ? stepFrom(raised, 1.05) : withLuminance(raised, Math.max(0.0025, (y + 0.05) / 1.2 - 0.05));

  // Tints laid over the panels: a grey carrying a little of the background's hue.
  const veil = high ? (dark ? "#ffffff" : "#000000") : dark ? tint(0.7) : tint(0.52);
  const lines = high ? (dark ? "#ffffff" : "#000000") : tint(0.7);
  const a = (hex: string, alpha: number) => toThemeHex(parseColour(hex)!.rgb, alpha);
  const overlays = high
    ? { "bg-hover": a(veil, 0.1), "bg-selected": a(veil, 0.16), "bg-active": a(veil, 0.22), "bg-message-hover": a(veil, 0.07) }
    : dark
      ? { "bg-hover": a(veil, 0.08), "bg-selected": a(veil, 0.12), "bg-active": a(veil, 0.16), "bg-message-hover": a(veil, 0.06) }
      : { "bg-hover": a(veil, 0.1), "bg-selected": a(veil, 0.16), "bg-active": a(veil, 0.22), "bg-message-hover": a(veil, 0.06) };
  const borders = high
    ? { "border-subtle": a(lines, dark ? 0.26 : 0.22), border: a(lines, dark ? 0.42 : 0.36), "border-strong": a(lines, dark ? 0.66 : 0.6) }
    : dark
      ? { "border-subtle": a(lines, 0.12), border: a(lines, 0.2), "border-strong": a(lines, 0.44) }
      : { "border-subtle": a(lines, 0.28), border: a(lines, 0.4), "border-strong": a(lines, 0.52) };

  const embed = dark ? surface : base;
  const codeBg = dark ? input_ : base;
  const revealed = dark ? input_ : surface;
  const panels = [base, raised, surface, floating, input_, embed, revealed];

  // The accent comes before the text: a mention lights a whole message up in
  // it, and the text has to read on that too.
  const brand = brandTokens(input.accent, scheme, [surface, raised, base, floating, input_, embed].sort((x, y) => (dark ? luminance(y) - luminance(x) : luminance(x) - luminance(y))), raised, { high, page: [base, raised] });

  // Everything text is read on: the panels, and the panels as they look lit
  // up under the pointer, selected, or mentioning you.
  const on = [
    ...panels,
    flatten(overlays["bg-selected"], base),
    flatten(overlays["bg-active"], surface),
    flatten(overlays["bg-message-hover"], raised),
    flatten(overlays["bg-hover"], floating),
    flatten(brand["mention-bg"], raised),
  ];
  const reading = [raised, surface, floating, embed, flatten(overlays["bg-message-hover"], raised)];
  const sidebar = [base, flatten(overlays["bg-selected"], base), flatten(overlays["bg-hover"], base)];
  const textTarget = high ? 7 : 4.5;

  const textTint = Math.min(o.c * 0.35, 0.012);
  const autoText = oklchToHex({ l: dark ? 0.96 : 0.29, c: textTint, h: o.h });
  const pickedText = input.text ? parseColour(input.text) : null;
  const text = pickedText ? ensureContrast(toHex(pickedText.rgb), on, textTarget) : ensureContrast(high ? (dark ? "#ffffff" : "#000000") : autoText, on, high ? 12 : 7);
  const strong = dark ? "#ffffff" : ensureContrast(oklchToHex({ l: 0.22, c: textTint, h: o.h }), on, high ? 12 : 7);
  const shade = (amount: number, toward = raised) => mixOk(text, toward, amount);

  const link = ensureContrast(oklchToHex(dark ? { l: 0.77, c: 0.12, h: 255 } : { l: 0.5, c: 0.17, h: 255 }), reading, textTarget);

  const status = (darkHex: string, lightHex: string) => ensureContrast(dark ? darkHex : lightHex, [raised, base, surface, floating], textTarget);
  const positive = whiteTextFill(dark ? "#3d9e60" : "#269153");
  const danger = whiteTextFill(dark ? "#da3e44" : "#d6363f");
  const warning = ensureContrast(dark ? "#fdb833" : "#c98300", [SOFT_BLACK], 4.6);

  const tooltipBg = dark ? oklchToHex({ l: 0.17, c: Math.min(o.c, 0.015), h: o.h }) : "#ffffff";
  const code = (darkHex: string, lightHex: string) => ensureContrast(dark ? darkHex : lightHex, [codeBg], textTarget);

  const tokens: TokenMap = {
    "bg-base": base,
    "bg-raised": raised,
    "bg-surface": surface,
    "bg-floating": floating,
    "bg-input": input_,
    "bg-composer": surface,
    "embed-bg": embed,
    "bg-overlay": a("#000000", dark ? (high ? 0.8 : 0.7) : 0.55),
    ...overlays,
    "scroll-thumb": a(veil, high ? 0.45 : dark ? 0.28 : 0.35),
    "scroll-thumb-hover": a(veil, high ? 0.65 : dark ? 0.45 : 0.55),
    "text-strong": strong,
    text,
    "text-subtle": ensureContrast(shade(0.2), on, textTarget),
    "text-muted": ensureContrast(shade(0.34), on, textTarget),
    "text-channel": ensureContrast(shade(0.42, base), sidebar, textTarget),
    "text-placeholder": ensureContrast(shade(0.46, input_), [input_, surface], textTarget),
    icon: ensureContrast(shade(0.26), on, textTarget),
    link,
    ...brand,
    ...borders,
    positive: positive.fill,
    "positive-hover": positive.hover,
    "on-positive": "#ffffff",
    warning,
    "text-warning": ensureContrast(dark ? "#fdb833" : "#8a5500", on, textTarget),
    "on-warning": SOFT_BLACK,
    danger: danger.fill,
    "danger-hover": danger.hover,
    "on-danger": "#ffffff",
    "text-danger": ensureContrast(dark ? "#fc8387" : "#c33139", on, textTarget),
    "status-online": status("#3d9e60", "#307d4c"),
    "status-idle": status("#f0b232", "#93660b"),
    "status-dnd": status("#e5484e", "#d42b35"),
    "status-offline": ensureContrast(mixOk(text, raised, 0.45), [raised, base, surface, floating], textTarget),
    "tooltip-bg": tooltipBg,
    "tooltip-text": ensureContrast(dark ? "#f2f3f5" : "#060607", [tooltipBg], 7),
    spoiler: tint(dark ? 0.62 : 0.66, 0.02),
    "spoiler-revealed": revealed,
    "code-bg": codeBg,
    "code-border": borders["border-subtle"],
    "code-keyword": code("#c678dd", "#cf222e"),
    "code-string": code("#98c379", "#0a3069"),
    "code-number": code("#d19a66", "#0550ae"),
    "code-comment": code("#8d939e", "#636b75"),
    "code-title": code("#61afef", "#7a3fd4"),
    "code-type": code("#e5c07b", "#116329"),
    "code-variable": code("#e06c75", "#953800"),
  };
  const pickedHex = pickedBg ? toHex(pickedBg.rgb) : raised;
  const accentHex = parseColour(input.accent);
  return {
    tokens,
    scheme,
    background: raised,
    adjusted: {
      background: raised !== pickedHex,
      accent: !!accentHex && brand.brand !== toHex(accentHex.rgb),
      text: !!pickedText && text !== toHex(pickedText.rgb),
    },
  };
}
