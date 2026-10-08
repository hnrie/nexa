import { deriveTheme } from "./derive";
import type { TokenMap } from "./tokens";
import type { Scheme } from "./types";

/**
 * Seasonal themes: palettes that can be picked only while their season lasts.
 * Each is worked out by derive.ts like the gallery's presets, so every one is
 * readable at AA, and each brings a small picture that sits on the message box
 * (components/common/SeasonalPerch.tsx; the files are assets/seasonal/<id>.svg,
 * which the Android app copies and draws too).
 *
 * A season is a span of days in the device's own calendar, the same every
 * year. Once it is over the theme draws as Dark, and the app sets the account's
 * theme back to Dark (ThemeEffect.tsx), so it does not come back by itself the
 * next year. Android keeps the same list (fish.nexa.ui.theme.look.Seasonal).
 */

export interface Season {
  id: string;
  /** i18n key of its name. */
  nameKey: string;
  scheme: Scheme;
  background: string;
  accent: string;
  /** First and last day, both included, as [month, day] with January as 1. A season may run past the new year. */
  from: [number, number];
  to: [number, number];
  /** The picture it sits on the message box, when it shares another season's: the night versions of the light ones. */
  art?: string;
  /** Snow falling behind the messages (components/chat/SnowFall.tsx). */
  snow?: boolean;
}

export const SEASONS: Season[] = [
  { id: "season-halloween", nameKey: "look.seasonal.halloween", scheme: "dark", background: "#1c1322", accent: "#f07a1a", from: [10, 1], to: [11, 2] },
  { id: "season-fall", nameKey: "look.seasonal.fall", scheme: "dark", background: "#221915", accent: "#cc5a2a", from: [9, 1], to: [11, 30] },
  { id: "season-winter", nameKey: "look.seasonal.winter", scheme: "light", background: "#f2f6fa", accent: "#2b6aa3", from: [12, 1], to: [2, 29] },
  { id: "season-winter-night", nameKey: "look.seasonal.winterNight", scheme: "dark", background: "#0f1a2a", accent: "#5b9be0", from: [12, 1], to: [2, 29], art: "season-winter", snow: true },
  { id: "season-holidays", nameKey: "look.seasonal.holidays", scheme: "dark", background: "#10201a", accent: "#c62f3a", from: [12, 1], to: [1, 6] },
  { id: "season-valentines", nameKey: "look.seasonal.valentines", scheme: "dark", background: "#2a1219", accent: "#ff5d8a", from: [2, 1], to: [2, 15] },
  { id: "season-spring", nameKey: "look.seasonal.spring", scheme: "light", background: "#f6faf1", accent: "#b23b7f", from: [3, 1], to: [5, 31] },
  { id: "season-spring-night", nameKey: "look.seasonal.springNight", scheme: "dark", background: "#16181f", accent: "#e06aa8", from: [3, 1], to: [5, 31], art: "season-spring" },
  { id: "season-summer", nameKey: "look.seasonal.summer", scheme: "light", background: "#f1fafa", accent: "#d4532d", from: [6, 1], to: [8, 31] },
  { id: "season-summer-night", nameKey: "look.seasonal.summerNight", scheme: "dark", background: "#0e1c22", accent: "#f07850", from: [6, 1], to: [8, 31], art: "season-summer" },
];

const BY_ID = new Map(SEASONS.map((s) => [s.id, s]));

/**
 * For trying them out: a build made with VITE_ALL_SEASONS=1 has every season
 * running every day. Never set for a deploy.
 */
const ALL_SEASONS = import.meta.env.VITE_ALL_SEASONS === "1";
const made = new Map<string, TokenMap>();

export function seasonById(id: string): Season | null {
  return BY_ID.get(id) ?? null;
}

export function isSeasonal(id: string): boolean {
  return BY_ID.has(id);
}

/** A day as one number that orders within a year: 1 January is 101, 31 December 1231. */
const dayOf = (month: number, day: number) => month * 100 + day;

/** Whether `on` falls inside the season, in the device's own time zone. */
export function inSeason(s: Season, on: Date): boolean {
  if (ALL_SEASONS) return true;
  const d = dayOf(on.getMonth() + 1, on.getDate());
  const a = dayOf(...s.from);
  const b = dayOf(...s.to);
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** The seasonal themes that can be picked on `on`, the one ending soonest first. */
export function seasonsOn(on: Date): Season[] {
  return SEASONS.filter((s) => inSeason(s, on)).sort((x, y) => seasonEnd(x, on).getTime() - seasonEnd(y, on).getTime());
}

/** The last day of the season that is running on `on`: this year's, or next year's when it runs past the new year. */
export function seasonEnd(s: Season, on: Date): Date {
  const [m, d] = s.to;
  const year = on.getFullYear() + (dayOf(on.getMonth() + 1, on.getDate()) > dayOf(m, d) ? 1 : 0);
  // 29 February in a year without one is the 28th, which new Date would roll on to 1 March
  const last = new Date(year, m, 0).getDate();
  return new Date(year, m - 1, Math.min(d, last));
}

/** A seasonal theme's palette, or null for an id that is not one. Worked out the first time it is asked for. */
export function seasonalTokens(id: string): TokenMap | null {
  const have = made.get(id);
  if (have) return have;
  const s = BY_ID.get(id);
  if (!s) return null;
  const tokens = deriveTheme({ background: s.background, accent: s.accent, text: null, scheme: s.scheme }).tokens;
  made.set(id, tokens);
  return tokens;
}

/**
 * The seasonal themes as the gallery shows them: one card for a season and its
 * night version, with a switch between the two on the card. `dark` is the
 * night version, or null for a season that has only one.
 */
export interface SeasonCard {
  light: Season;
  dark: Season | null;
}

export function seasonCards(seasons: readonly Season[]): SeasonCard[] {
  const nights = new Set(seasons.filter((s) => s.art && BY_ID.has(s.art)).map((s) => s.id));
  return seasons.filter((s) => !nights.has(s.id)).map((s) => ({ light: s, dark: seasons.find((n) => nights.has(n.id) && n.art === s.id) ?? null }));
}

/** The theme `id` draws as today: itself while its season lasts, Dark once it is over. Any other id is its own. */
export function seasonalOrDefault(id: string, on: Date): string {
  const s = BY_ID.get(id);
  return s && !inSeason(s, on) ? "dark" : id;
}

/** The season of a theme that is in season on `on`, for the picture on the message box. */
export function activeSeason(id: string, on: Date): Season | null {
  const s = BY_ID.get(id);
  return s && inSeason(s, on) ? s : null;
}
