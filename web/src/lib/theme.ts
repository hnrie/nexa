import { blend, contrast, parseHex, readableOn, rgbToHsl, shade, toHex, tuneForContrast, withAlpha } from "@/lib/color";
import { storage } from "@/lib/storage";
import type { Settings } from "@/stores/settings";

/** What applyTheme draws the page with. */
export type Appearance = Pick<Settings, "theme" | "accent" | "fontScale" | "reducedMotion" | "underlineLinks">;

/**
 * The surface in each theme that is hardest to read on, which is where anything
 * derived from the accent has to be measured. A dark theme's derived colours
 * come out light, so their worst case is the palest panel it has; a light
 * theme's come out dark, so theirs is the greyest. Only the accent is known at
 * run time — these are not, because they live in a stylesheet.
 */
export const SURFACE_BG: Record<"dark" | "light" | "ash" | "onyx", string> = {
  dark: "#393a41",
  light: "#ebeced",
  ash: "#27272c",
  onyx: "#16171a",
};

/** How much of the accent a mention pill is tinted with, resting and hovered. */
const MENTION_ALPHA = { dark: [0.26, 0.42], light: [0.16, 0.32] } as const;

const ACCENT_VARS = ["--brand", "--brand-hover", "--brand-active", "--on-brand", "--focus-ring", "--mention-bg", "--mention-bg-hover", "--mention-fg", "--text-brand"];

/**
 * `brand` moved `delta` along the lightness scale, pulled back towards where it
 * started for as long as the move would cost the fill the text that goes on it.
 * At worst it gives the colour back unchanged, which is always readable.
 */
function shadeKeeping(brand: string, fg: string, delta: number): string {
  for (let i = 10; i > 0; i--) {
    const out = shade(brand, (delta * i) / 10);
    if (contrast(out, fg) >= 4.5) return out;
  }
  return brand;
}

export function resolveTheme(theme: Settings["theme"]): "dark" | "light" | "ash" | "onyx" {
  if (theme !== "system") return theme;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

/**
 * Every custom property a chosen accent implies, worked out from the colour
 * itself rather than assumed. The picker takes any colour at all, so nothing
 * here may hold only for the ten presets: the foreground is the one of black
 * and white that is further from the fill, the focus ring is nudged until it
 * can be seen against the page, and the mention pill's text is nudged until it
 * can be read on the pill.
 */
export function accentVars(accent: string, theme: "dark" | "light" | "ash" | "onyx"): Record<string, string> | null {
  const rgb = parseHex(accent);
  if (!rgb) return null;
  const brand = toHex(rgb);
  const surface = SURFACE_BG[theme];
  const fg = readableOn(brand);
  // Hover darkens the fill, as it always has, except where the accent is
  // already so dark that going further would flatten it to black and leave
  // nothing to see; those brighten instead.
  const dir = rgbToHsl(rgb).l > 0.22 ? -1 : 1;
  const hover = shadeKeeping(brand, fg, dir * 0.1);
  const active = shadeKeeping(brand, fg, dir * 0.18);
  // A mention reads as a tint of the accent, lighter on a light page so the
  // dark text that then goes on it still has somewhere to be dark against. Its
  // own colour is measured on the hovered pill, which is the stronger tint.
  const [rest, hovered] = MENTION_ALPHA[theme === "light" ? "light" : "dark"];
  const pill = toHex(blend(brand, surface, hovered));
  return {
    "--brand": brand,
    "--brand-hover": hover,
    "--brand-active": active,
    "--on-brand": fg,
    "--focus-ring": tuneForContrast(brand, surface, 3),
    "--mention-bg": withAlpha(brand, rest),
    "--mention-bg-hover": withAlpha(brand, hovered),
    "--mention-fg": tuneForContrast(brand, pill, 4.5),
    "--text-brand": tuneForContrast(brand, surface, 4.5),
  };
}

/** Applies theme, accent, font scale and motion preferences to the document. */
export function applyTheme(s: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(s.theme);
  if (resolved === "dark") delete root.dataset["theme"];
  else root.dataset["theme"] = resolved;
  root.style.setProperty("--font-scale", String(Math.min(1.5, Math.max(0.75, s.fontScale || 1))));
  const vars = s.accent ? accentVars(s.accent, resolved) : null;
  if (vars) for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  else for (const v of ACCENT_VARS) root.style.removeProperty(v);
  root.dataset["reducedMotion"] = s.reducedMotion ? "true" : "false";
  root.dataset["underlineLinks"] = s.underlineLinks ? "true" : "false";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f3f3f4" : resolved === "onyx" ? "#000000" : resolved === "ash" ? "#1a1a1e" : "#2c2d32");
}

const REMEMBERED = "ec:appearance";
const THEMES: readonly Settings["theme"][] = ["dark", "light", "ash", "onyx", "system"];

/**
 * The appearance this device last drew the app in.
 *
 * The account's own settings are encrypted and arrive with the gateway's
 * ready, a second or two after the page has already been drawn — in the
 * default dark theme, at the default size. Someone who uses the light theme
 * saw a dark flash on every reload, and a larger font made the whole layout
 * jump once the settings landed. Remembering the last appearance here lets
 * the first frame already be the right one. Anything unreadable is ignored
 * rather than trusted: a bad value costs the flash, never a broken page.
 */
export function rememberedAppearance(): Appearance | null {
  const raw = storage.get(REMEMBERED);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object" || !THEMES.includes(v["theme"] as Settings["theme"])) return null;
    const accent = typeof v["accent"] === "string" && parseHex(v["accent"]) ? v["accent"] : null;
    const scale = Number(v["fontScale"]);
    return {
      theme: v["theme"] as Settings["theme"],
      accent,
      fontScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      reducedMotion: v["reducedMotion"] === true,
      underlineLinks: v["underlineLinks"] === true,
    };
  } catch {
    return null;
  }
}

/** Keeps the appearance for the next page load on this device (see rememberedAppearance). */
export function rememberAppearance(a: Appearance): void {
  storage.set(REMEMBERED, JSON.stringify({ theme: a.theme, accent: a.accent, fontScale: a.fontScale, reducedMotion: a.reducedMotion, underlineLinks: a.underlineLinks }));
}

/** Draws the page in the remembered appearance, if there is one; for before the first render. */
export function applyRememberedAppearance(): void {
  const a = rememberedAppearance();
  if (a) applyTheme(a);
}
