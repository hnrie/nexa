const PALETTE = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#8b5cf6"];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0]!;
}

/** The first character as a reader sees it: a flag, a family emoji or an accented letter is one. */
function firstGrapheme(text: string): string {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return Array.from(text)[0] ?? "";
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = firstGrapheme(trimmed) || "?";
  // "ß" upper-cases to "SS", which is two letters in a space for one
  const upper = first.toUpperCase();
  return upper.length === first.length ? upper : first;
}

/** The CSS background for a profile banner area: a gradient when two colours are set. */
export function profileTheme(primary: number | null | undefined, secondary: number | null | undefined, fallbackId?: string): string {
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
  if (primary !== null && primary !== undefined && secondary !== null && secondary !== undefined) {
    return `linear-gradient(135deg, ${hex(primary)} 0%, ${hex(secondary)} 100%)`;
  }
  if (primary !== null && primary !== undefined) return hex(primary);
  return fallbackId ? avatarColor(fallbackId) : "var(--brand)";
}

const hexOf = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * A profile's theme, as Discord's: with two colours the whole card is a
 * gradient from the first to the second, and its text turns dark on a light
 * pair and light on a dark one. One colour only colours the banner.
 */
export function profileThemeOf(primary: number | null | undefined, secondary: number | null | undefined): { top: string; bottom: string; text: "light" | "dark" } | null {
  if (primary === null || primary === undefined || secondary === null || secondary === undefined) return null;
  const top = hexOf(primary);
  const bottom = hexOf(secondary);
  // text is read over the whole card, so both ends count
  const light = (luminance(top) + luminance(bottom)) / 2 > 0.45;
  return { top, bottom, text: light ? "dark" : "light" };
}
