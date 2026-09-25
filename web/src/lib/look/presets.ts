import { deriveTheme, type DeriveOptions } from "./derive";
import { CLASSIC, CLASSIC_IDS, type TokenMap } from "./tokens";
import type { ClassicTheme, Scheme, SimpleColours } from "./types";

/**
 * The themes the gallery offers. The four classic ones are drawn by
 * tokens.css; every other one is worked out from a background and an accent
 * by derive.ts, so each is a whole palette with every text colour at AA or
 * better (presets.test.ts checks each against the same rules the builder
 * warns with).
 */

export type PresetGroup = "classic" | "dark" | "light" | "plain";

export interface Preset {
  id: string;
  /** i18n key of its name. */
  nameKey: string;
  scheme: Scheme;
  group: PresetGroup;
  /** Links underlined whatever the setting says: colour alone does not set them apart in these. */
  underlineLinks: boolean;
}

interface Recipe {
  id: string;
  nameKey: string;
  group: PresetGroup;
  colours: Omit<SimpleColours, "text"> & { text?: string };
  options?: DeriveOptions;
  underlineLinks?: boolean;
}

const RECIPES: Recipe[] = [
  { id: "nexa", nameKey: "look.presets.nexa", group: "dark", colours: { background: "#211a30", accent: "#8000ff", scheme: "dark" } },
  { id: "midnight", nameKey: "look.presets.midnight", group: "dark", colours: { background: "#151c2e", accent: "#4466ee", scheme: "dark" } },
  { id: "forest", nameKey: "look.presets.forest", group: "dark", colours: { background: "#18221d", accent: "#2e8052", scheme: "dark" } },
  { id: "rose", nameKey: "look.presets.rose", group: "dark", colours: { background: "#261b21", accent: "#c93d6b", scheme: "dark" } },
  { id: "amber", nameKey: "look.presets.amber", group: "dark", colours: { background: "#241e16", accent: "#eaa23a", scheme: "dark" } },
  { id: "ocean", nameKey: "look.presets.ocean", group: "dark", colours: { background: "#10202a", accent: "#127f91", scheme: "dark" } },
  { id: "nexa-light", nameKey: "look.presets.nexaLight", group: "light", colours: { background: "#fbf9ff", accent: "#7400f0", scheme: "light" } },
  { id: "forest-light", nameKey: "look.presets.forestLight", group: "light", colours: { background: "#f6faf5", accent: "#1d7c47", scheme: "light" } },
  { id: "rose-light", nameKey: "look.presets.roseLight", group: "light", colours: { background: "#fff7f9", accent: "#c0245b", scheme: "light" } },
  { id: "amber-light", nameKey: "look.presets.amberLight", group: "light", colours: { background: "#fffaf0", accent: "#a85a00", scheme: "light" } },
  { id: "ocean-light", nameKey: "look.presets.oceanLight", group: "light", colours: { background: "#f3fafc", accent: "#08707f", scheme: "light" } },
  { id: "greyscale", nameKey: "look.presets.greyscale", group: "plain", colours: { background: "#262626", accent: "#d6d6d6", scheme: "dark" }, underlineLinks: true },
  { id: "greyscale-light", nameKey: "look.presets.greyscaleLight", group: "plain", colours: { background: "#fafafa", accent: "#404040", scheme: "light" }, underlineLinks: true },
  { id: "contrast", nameKey: "look.presets.contrast", group: "plain", colours: { background: "#000000", accent: "#c4a1ff", scheme: "dark" }, options: { contrast: "high" }, underlineLinks: true },
  { id: "contrast-light", nameKey: "look.presets.contrastLight", group: "plain", colours: { background: "#ffffff", accent: "#5a00c8", scheme: "light" }, options: { contrast: "high" }, underlineLinks: true },
];

const CLASSIC_NAMES: Record<ClassicTheme, string> = {
  dark: "settings.appearance.themeDark",
  light: "settings.appearance.themeLight",
  ash: "settings.appearance.themeAsh",
  onyx: "settings.appearance.themeOnyx",
};

/** Every theme in the gallery but "Sync with system", in the order it shows them. */
export const PRESETS: Preset[] = [
  ...CLASSIC_IDS.map((id) => ({ id, nameKey: CLASSIC_NAMES[id], scheme: (id === "light" ? "light" : "dark") as Scheme, group: "classic" as const, underlineLinks: false })),
  ...RECIPES.map((r) => ({ id: r.id, nameKey: r.nameKey, scheme: r.colours.scheme, group: r.group, underlineLinks: !!r.underlineLinks })),
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
const made = new Map<string, TokenMap>();

export function presetById(id: string): Preset | null {
  return BY_ID.get(id) ?? null;
}

/** The recipe a derived preset is made from, for a custom theme that starts from it in simple mode. */
export function presetColours(id: string): SimpleColours | null {
  const r = RECIPE_BY_ID.get(id);
  return r ? { background: r.colours.background, accent: r.colours.accent, text: r.colours.text ?? null, scheme: r.colours.scheme } : null;
}

/** A preset's whole palette; worked out the first time it is asked for. */
export function presetTokens(id: string): TokenMap | null {
  if ((CLASSIC_IDS as readonly string[]).includes(id)) return CLASSIC[id as ClassicTheme];
  const have = made.get(id);
  if (have) return have;
  const r = RECIPE_BY_ID.get(id);
  if (!r) return null;
  const tokens = deriveTheme({ ...r.colours, text: r.colours.text ?? null }, r.options).tokens;
  made.set(id, tokens);
  return tokens;
}
