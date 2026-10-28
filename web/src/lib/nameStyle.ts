/**
 * Name styles: how someone's display name is drawn to everyone (the server's
 * api/name_style.go): one of the fonts below, an effect, and the effect's
 * colours. The Android app keeps the same lists in data/NameStyle.kt and draws
 * the same fonts (android/tools/name_fonts.py copies them).
 *
 * In a server a coloured role still colours the name; the font always shows.
 */
import type { CSSProperties } from "react";
import { t } from "@/i18n";

export type NameEffect = "solid" | "gradient" | "glow" | "ink" | "pop" | "candy" | "aurora" | "chrome" | "holo" | "neon" | "flame";

export interface NameStyle {
  /** One of NAME_FONTS' ids, or "" for the app's own. */
  font: string;
  effect: NameEffect;
  /** Omitted styles retain their original motion. */
  animated?: boolean;
  /** 0xRRGGBB, as many as the effect takes (NAME_EFFECTS). Solid with none is the usual colour. */
  colors: number[];
}

/**
 * The fonts on offer: the family each is served as (styles/nameFonts.css), and
 * how much it is scaled so its lowercase letters (a capitals-only font's
 * capitals) are as tall as the app's own font's, measured from the letters
 * themselves. The web does that with font-size-adjust; Android with the scale.
 */
export const NAME_FONTS: { id: string; family: string; scale: number; label: string; caps?: boolean }[] = [
  { id: "", family: "", scale: 1, label: "" },
  { id: "comic", family: "Comic Neue", scale: 1.0, label: "Comic" },
  { id: "fraunces", family: "Fraunces", scale: 1.02, label: "Fraunces" },
  { id: "playfair", family: "Playfair Display", scale: 0.95, label: "Playfair" },
  { id: "dmserif", family: "DM Serif Display", scale: 1.02, label: "DM Serif" },
  { id: "youngserif", family: "Young Serif", scale: 0.98, label: "Young Serif" },
  { id: "syne", family: "Syne", scale: 0.99, label: "Syne" },
  { id: "bricolage", family: "Bricolage Grotesque", scale: 0.94, label: "Bricolage" },
  { id: "spacegrotesk", family: "Space Grotesk", scale: 0.99, label: "Space Grotesk" },
  { id: "outfit", family: "Outfit", scale: 1.02, label: "Outfit" },
  { id: "lexend", family: "Lexend", scale: 0.93, label: "Lexend" },
  { id: "sora", family: "Sora", scale: 0.9, label: "Sora" },
  { id: "rubik", family: "Rubik", scale: 0.95, label: "Rubik" },
  { id: "fredoka", family: "Fredoka", scale: 0.99, label: "Fredoka" },
  { id: "comfortaa", family: "Comfortaa", scale: 0.9, label: "Comfortaa" },
  { id: "baloo", family: "Baloo 2", scale: 1.01, label: "Baloo" },
  { id: "quicksand", family: "Quicksand", scale: 0.92, label: "Quicksand" },
  { id: "bungee", family: "Bungee", scale: 0.99, label: "Bungee", caps: true },
  { id: "righteous", family: "Righteous", scale: 0.94, label: "Righteous" },
  { id: "chewy", family: "Chewy", scale: 0.9, label: "Chewy" },
  { id: "shrikhand", family: "Shrikhand", scale: 0.93, label: "Shrikhand" },
  { id: "titan", family: "Titan One", scale: 0.85, label: "Titan" },
  { id: "orbitron", family: "Orbitron", scale: 0.85, label: "Orbitron" },
  { id: "pacifico", family: "Pacifico", scale: 1.05, label: "Pacifico" },
  { id: "lobster", family: "Lobster", scale: 0.94, label: "Lobster" },
  { id: "kalam", family: "Kalam", scale: 0.93, label: "Kalam" },
  { id: "patrick", family: "Patrick Hand", scale: 1.05, label: "Patrick Hand" },
  { id: "caveat", family: "Caveat", scale: 1.34, label: "Caveat" },
  { id: "pixelify", family: "Pixelify Sans", scale: 1.07, label: "Pixelify" },
  { id: "spacemono", family: "Space Mono", scale: 0.99, label: "Space Mono" },
];

/**
 * Each effect, how many colours it takes, and the colours it starts with when
 * picked. `paid` ones come with a plan (lib/plans.ts); the server sends one an
 * account without a plan still has saved as its first colour alone.
 */
export const NAME_EFFECTS: { id: NameEffect; min: number; max: number; start: number[]; paid?: boolean }[] = [
  { id: "solid", min: 0, max: 1, start: [] },
  { id: "gradient", min: 2, max: 2, start: [0x5ec8c0, 0xf2c58b] },
  { id: "glow", min: 1, max: 1, start: [0xb46cff] },
  { id: "ink", min: 1, max: 1, start: [0xff5ca8] },
  { id: "pop", min: 1, max: 1, start: [0x2fd27a] },
  { id: "candy", min: 2, max: 4, start: [0xf7a8d0, 0xa8dcf7, 0xc3b1f5, 0xb6f0c9] },
  { id: "aurora", min: 2, max: 5, start: [0xf29a4a, 0x6ee38a, 0xf6e05e, 0xe85bc8, 0x6a6af2] },
  { id: "chrome", min: 1, max: 1, start: [0x9fb6d6] },
  { id: "holo", min: 1, max: 1, start: [0xa98bff], paid: true },
  { id: "neon", min: 1, max: 1, start: [0x3df0ff], paid: true },
  { id: "flame", min: 2, max: 2, start: [0xff4d1a, 0xffd23f], paid: true },
];

/** Ready-made colours for each effect that takes more than one, beside picking your own. */
export const NAME_PALETTES: Partial<Record<NameEffect, number[][]>> = {
  gradient: [[0x5ec8c0, 0xf2c58b], [0xc86bff, 0x4f7cf2], [0xf0a3b8, 0xc67be0], [0xe2513f, 0xb98cf2], [0x45b86a, 0x9fe6ee], [0xf09a4a, 0xd65ad8]],
  candy: [[0xf7a8d0, 0xa8dcf7, 0xc3b1f5, 0xb6f0c9], [0xf06fb8, 0xe0559f, 0xf5a3d4, 0xcc6aa8], [0xf6c28b, 0xf09a76, 0xee7f7f, 0xdc6f8a], [0xd3ef7a, 0xa6dc6e, 0x82c96d, 0x63b36a], [0x8ab8f8, 0xa2e1d6, 0x9b96ea, 0x7fcde9], [0xca82f8, 0xa86bf0, 0xd45ed8, 0x8a6cf2]],
  flame: [[0xff4d1a, 0xffd23f], [0xe0124a, 0xff8a3d], [0x6a5cff, 0x3fe0ff], [0x2fd27a, 0xe6ff6b], [0xd65ad8, 0xffb3e6], [0x2b6cf2, 0xb8f0ff]],
  aurora: [[0xf29a4a, 0x6ee38a, 0xf6e05e, 0xe85bc8, 0x6a6af2], [0xe6533c, 0xf4cf62, 0xa45df0], [0x8a1d1d, 0xe55b2b, 0xf2b23a], [0x8fdcf2, 0xc69cf5, 0xf29bd6], [0x47c98a, 0x4a8cf2, 0x7a4ef0], [0xd8f2a0, 0xf2e19a, 0xf4bfd9]],
};

/** A colour for each solid, glow, ink, pop and chrome swatch. */
export const NAME_SWATCHES = [0xf7339f, 0x2fd27a, 0x2b9cf2, 0xc63cf5, 0xe0124a, 0xf2482a, 0xd4a817];

const EFFECT_IDS = NAME_EFFECTS.map((e) => e.id);

/** A style as sent, read defensively: anything malformed is the plain name (null). */
export function readNameStyle(x: unknown): NameStyle | null {
  if (!x || typeof x !== "object") return null;
  const raw = x as Record<string, unknown>;
  const font = typeof raw["font"] === "string" && NAME_FONTS.some((f) => f.id === raw["font"]) ? raw["font"] : "";
  const effect = EFFECT_IDS.includes(raw["effect"] as NameEffect) ? (raw["effect"] as NameEffect) : "solid";
  const spec = NAME_EFFECTS.find((e) => e.id === effect)!;
  const colors = Array.isArray(raw["colors"]) ? raw["colors"].filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, spec.max) : [];
  if (colors.length < spec.min) return null;
  if (!font && effect === "solid" && colors.length === 0) return null;
  return { font, effect, colors, ...(typeof raw["animated"] === "boolean" ? { animated: raw["animated"] } : {}) };
}

export function sameNameStyle(a: NameStyle | null, b: NameStyle | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The same style with another effect, keeping the colours that still fit and filling the rest from its start. */
export function withEffect(style: NameStyle | null, effect: NameEffect): NameStyle {
  const spec = NAME_EFFECTS.find((e) => e.id === effect)!;
  let colors = (style?.colors ?? []).slice(0, spec.max);
  if (colors.length < spec.min || (colors.length === 0 && effect !== "solid")) colors = spec.start.slice();
  return { font: style?.font ?? "", effect, colors, ...(style?.animated !== undefined ? { animated: style.animated } : {}) };
}

/** Something to try: a font, an effect and colours picked at random; the paid effects only with a plan. */
export function surpriseStyle(rand: () => number = Math.random, paid = false): NameStyle {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const effect = pick(NAME_EFFECTS.slice(1).filter((e) => paid || !e.paid)).id;
  const palettes = NAME_PALETTES[effect];
  const colors = palettes ? pick(palettes) : [pick(NAME_SWATCHES)];
  return { font: pick(NAME_FONTS).id, effect, colors };
}

/** Wix Madefor Display's lowercase and capital heights, as fractions of its size: what every name font is matched to. */
const X_HEIGHT = 0.492;
const CAP_HEIGHT = 0.715;

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Missing motion choices keep each effect's original behavior. */
export function nameStyleAnimated(style: NameStyle): boolean {
  return style.animated ?? ["aurora", "holo", "neon", "flame"].includes(style.effect);
}

/** The class a styled name takes; role colours override personal effects. */
export function nameStyleClass(style: NameStyle | null, roleColoured: boolean): string {
  if (!style) return "";
  const out = style.font ? ["ns-font"] : [];
  if (!roleColoured && style.colors.length) {
    out.push("ns", `ns-${style.effect}`);
    if (nameStyleAnimated(style)) out.push("ns-animated");
  }
  return out.join(" ");
}

let fontsLoading: Promise<unknown> | null = null;

/** Fetches the fonts' stylesheet the first time a name needs one of them. */
export function loadNameFonts(): void {
  fontsLoading ??= import("@/styles/nameFonts.css").catch(() => {
    fontsLoading = null;
  });
}

/** The custom properties a styled name's class reads. */
export function nameStyleVars(style: NameStyle | null, roleColoured: boolean): CSSProperties | undefined {
  if (!style) return undefined;
  const v: Record<string, string> = {};
  const font = style.font ? NAME_FONTS.find((f) => f.id === style.font) : undefined;
  if (font) {
    loadNameFonts();
    v["--ns-family"] = `"${font.family}"`;
    v["--ns-adjust"] = font.caps ? `cap-height ${CAP_HEIGHT}` : String(X_HEIGHT);
  }
  if (!roleColoured && style.colors.length) {
    const cs = style.colors.map(hex);
    v["--ns-c1"] = cs[0]!;
    v["--ns-c2"] = cs[1] ?? cs[0]!;
    if (style.effect === "candy") {
      const band = 0.42;
      v["--ns-stripes"] = cs.map((c, i) => `${c} ${(i * band).toFixed(2)}em ${((i + 1) * band).toFixed(2)}em`).join(", ");
      v["--ns-stripe-run"] = `${(cs.length * band).toFixed(2)}em`;
    }
    if (style.effect === "aurora") v["--ns-stops"] = [...cs, cs[0]!].join(", ");
  }
  return v as CSSProperties;
}

/** A style as words a moderator reads: its effect, its font and its colours. */
export function nameStyleText(style: NameStyle | null): string {
  if (!style) return "";
  const font = NAME_FONTS.find((f) => f.id === style.font)?.label;
  return [t(`nameStyle.effects.${style.effect}`), font, ...style.colors.map(hex)].filter(Boolean).join(" ");
}
