import { luminance, parseColour, toHex } from "@/lib/color";
import { deriveTheme, fitBackground, schemeOf } from "./derive";
import { presetById, presetTokens } from "./presets";
import { ALPHA_TOKENS, CLASSIC, TOKENS, isToken, normaliseColour, type TokenMap, type TokenName } from "./tokens";
import type { CustomTheme, Scheme, SimpleColours } from "./types";

/** How many custom themes an account keeps, and how long a name may be. */
export const MAX_CUSTOM_THEMES = 30;
export const MAX_THEME_NAME = 48;

export const isCustomId = (id: string): boolean => /^custom-[a-z0-9]{8}$/.test(id);

export function newThemeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "custom-" + [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** A colour as a solid token may hold it: any alpha is dropped, since a see-through panel would show what is behind the app. */
function solid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const c = parseColour(value);
  return c ? toHex(c.rgb) : null;
}

/** A token's value, or null when it is not a colour that token can take. */
export function tokenValue(token: TokenName, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  return ALPHA_TOKENS.has(token) ? normaliseColour(value) : solid(value);
}

function sanitizeSimple(v: Record<string, unknown>): SimpleColours | null {
  const background = solid(v["background"]);
  const accent = solid(v["accent"]);
  if (!background || !accent) return null;
  const scheme: Scheme = v["scheme"] === "light" || v["scheme"] === "dark" ? v["scheme"] : schemeOf(background);
  return { background, accent, text: solid(v["text"]), scheme };
}

function sanitizeOverrides(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v !== "object" || v === null) return out;
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    const name = k.replace(/^--/, "");
    if (!isToken(name)) continue;
    const ok = tokenValue(name, value);
    if (ok) out[name] = ok;
  }
  return out;
}

/**
 * A custom theme read from the settings, or null when it cannot be one. The
 * settings arrive from every device of the account, some of them on older or
 * newer versions, so nothing is taken on trust: a theme is only drawn from
 * values that are colours.
 */
export function sanitizeTheme(v: unknown): CustomTheme | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = typeof r["id"] === "string" && isCustomId(r["id"]) ? r["id"] : null;
  if (!id) return null;
  const name = typeof r["name"] === "string" ? r["name"].trim().slice(0, MAX_THEME_NAME) : "";
  const src = r["source"] as Record<string, unknown> | undefined;
  let source: CustomTheme["source"] | null = null;
  if (src && src["kind"] === "simple") {
    const simple = sanitizeSimple(src);
    if (simple) source = { kind: "simple", ...simple };
  } else if (src && src["kind"] === "preset" && typeof src["id"] === "string" && presetById(src["id"])) {
    source = { kind: "preset", id: src["id"] };
  }
  if (!source) return null;
  return { id, name, source, overrides: sanitizeOverrides(r["overrides"]) };
}

export function sanitizeThemes(v: unknown): CustomTheme[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: CustomTheme[] = [];
  for (const item of v) {
    const t = sanitizeTheme(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= MAX_CUSTOM_THEMES) break;
  }
  return out;
}

/** The palette a custom theme's source gives, before any colour set by hand. */
export function sourceTokens(source: CustomTheme["source"]): TokenMap {
  if (source.kind === "simple") return deriveTheme(source).tokens;
  return presetTokens(source.id) ?? CLASSIC.dark;
}

export interface ResolvedTheme {
  tokens: TokenMap;
  scheme: Scheme;
}

/**
 * A custom theme's whole palette: its source's, with the colours set by hand
 * over it. Its scheme follows the main background as it ends up, so a dark
 * preset turned light in the advanced editor is drawn as a light theme.
 */
export function resolveCustom(theme: CustomTheme): ResolvedTheme {
  const tokens = { ...sourceTokens(theme.source) };
  for (const [k, v] of Object.entries(theme.overrides)) if (isToken(k)) tokens[k] = v;
  return { tokens, scheme: luminance(toHex(parseColour(tokens["bg-raised"])?.rgb ?? [0, 0, 0])) > 0.18 ? "light" : "dark" };
}

/** The palette of any theme the gallery can show: classic, preset or custom. */
export function themeTokens(id: string, customs: readonly CustomTheme[]): TokenMap | null {
  const preset = presetTokens(id);
  if (preset) return preset;
  const custom = isCustomId(id) ? customs.find((c) => c.id === id) : undefined;
  return custom ? resolveCustom(custom).tokens : null;
}

/** Whether links should be underlined in this custom theme: when it starts from a preset that asks for it. */
export function customUnderlines(theme: CustomTheme): boolean {
  return theme.source.kind === "preset" && !!presetById(theme.source.id)?.underlineLinks;
}

/* Sharing a theme as a file. */

const FORMAT = 1;

export function exportTheme(theme: CustomTheme): string {
  const { tokens, scheme } = resolveCustom(theme);
  const doc: Record<string, unknown> = { nexaTheme: FORMAT, name: theme.name, scheme };
  if (theme.source.kind === "simple") doc["simple"] = { background: theme.source.background, accent: theme.source.accent, text: theme.source.text, scheme: theme.source.scheme };
  else doc["basedOn"] = theme.source.id;
  if (Object.keys(theme.overrides).length) doc["overrides"] = theme.overrides;
  doc["colors"] = Object.fromEntries(TOKENS.map((t) => [t, tokens[t]]));
  return JSON.stringify(doc, null, 2);
}

export type ImportResult = { ok: true; theme: CustomTheme } | { ok: false; error: "notJson" | "notTheme" | "newer" };

/**
 * A theme from a file someone shared. It keeps what makes it editable where
 * it can: the few colours of a simple theme, or the preset it was built on
 * with its hand-set colours. Failing both, the full list of colours becomes
 * hand-set colours over the classic theme of its scheme.
 */
export function importTheme(text: string, fallbackName: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ok: false, error: "notTheme" };
  const d = doc as Record<string, unknown>;
  if (typeof d["nexaTheme"] === "number" && d["nexaTheme"] > FORMAT) return { ok: false, error: "newer" };
  const name = (typeof d["name"] === "string" && d["name"].trim() ? d["name"].trim() : fallbackName).slice(0, MAX_THEME_NAME);
  const overrides = sanitizeOverrides(d["overrides"]);
  const simple = typeof d["simple"] === "object" && d["simple"] !== null ? sanitizeSimple(d["simple"] as Record<string, unknown>) : null;
  if (simple) return { ok: true, theme: { id: newThemeId(), name, source: { kind: "simple", ...simple, background: fitBackground(simple.background, simple.scheme) }, overrides } };
  if (typeof d["basedOn"] === "string" && presetById(d["basedOn"])) return { ok: true, theme: { id: newThemeId(), name, source: { kind: "preset", id: d["basedOn"] }, overrides } };
  const colours = sanitizeOverrides(d["colors"] ?? d["colours"]);
  if (Object.keys(colours).length === 0) return { ok: false, error: "notTheme" };
  const raised = colours["bg-raised"] ?? colours["bg-base"];
  const scheme: Scheme = d["scheme"] === "light" || d["scheme"] === "dark" ? d["scheme"] : raised ? schemeOf(raised) : "dark";
  const base = scheme === "light" ? "light" : "dark";
  // only what differs from the base is kept, which is what the editor shows as changed
  const diff = Object.fromEntries(Object.entries({ ...colours, ...overrides }).filter(([k, v]) => CLASSIC[base][k as TokenName] !== v));
  return { ok: true, theme: { id: newThemeId(), name, source: { kind: "preset", id: base }, overrides: diff } };
}
