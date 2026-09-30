import { parseColour, toThemeHex } from "@/lib/color";
import type { ClassicTheme } from "./types";

/**
 * Every colour a theme sets, grouped the way the theme builder lists them.
 * Names are the custom properties in styles/tokens.css without the leading
 * dashes. Shadows, radii and sizes are not here: a theme is its colours.
 */
export const TOKEN_GROUPS = [
  { id: "backgrounds", tokens: ["bg-base", "bg-raised", "bg-surface", "bg-floating", "bg-input", "bg-composer", "embed-bg", "bg-overlay"] },
  { id: "interaction", tokens: ["bg-hover", "bg-selected", "bg-active", "bg-message-hover", "scroll-thumb", "scroll-thumb-hover"] },
  { id: "text", tokens: ["text-strong", "text", "text-subtle", "text-muted", "text-channel", "text-placeholder", "icon", "link"] },
  { id: "accent", tokens: ["brand", "brand-hover", "brand-active", "on-brand", "text-brand", "focus-ring", "mention-bg", "mention-bg-hover", "mention-fg"] },
  { id: "borders", tokens: ["border-subtle", "border", "border-strong"] },
  { id: "status", tokens: ["positive", "positive-hover", "on-positive", "warning", "text-warning", "on-warning", "danger", "danger-hover", "on-danger", "text-danger", "status-online", "status-idle", "status-dnd", "status-offline"] },
  { id: "content", tokens: ["tooltip-bg", "tooltip-text", "spoiler", "spoiler-revealed", "code-bg", "code-border", "code-keyword", "code-string", "code-number", "code-comment", "code-title", "code-type", "code-variable"] },
] as const;

export type TokenGroup = (typeof TOKEN_GROUPS)[number]["id"];
export type TokenName = (typeof TOKEN_GROUPS)[number]["tokens"][number];
/** A whole theme: a value for every token, as #rrggbb or #rrggbbaa. */
export type TokenMap = Record<TokenName, string>;

export const TOKENS: readonly TokenName[] = TOKEN_GROUPS.flatMap((g) => g.tokens as readonly TokenName[]);
const TOKEN_SET = new Set<string>(TOKENS);
export const isToken = (name: string): name is TokenName => TOKEN_SET.has(name);

/** The ones meant to be see-through: tints laid over whatever is under them. The editor gives them an opacity. */
export const ALPHA_TOKENS: ReadonlySet<TokenName> = new Set<TokenName>(["bg-overlay", "bg-hover", "bg-selected", "bg-active", "bg-message-hover", "scroll-thumb", "scroll-thumb-hover", "mention-bg", "mention-bg-hover", "border-subtle", "border", "border-strong", "code-border"]);

/** Which group a token is listed under. */
export function groupOf(token: TokenName): TokenGroup {
  return TOKEN_GROUPS.find((g) => (g.tokens as readonly string[]).includes(token))!.id;
}

/** A value as a theme stores it, or null when it is not a colour. */
export function normaliseColour(value: string): string | null {
  const c = parseColour(value);
  return c ? toThemeHex(c.rgb, c.alpha) : null;
}

/*
 * The four classic themes as tokens.css draws them, for the gallery's
 * pictures and for a custom theme that starts from one of them. tokens.test.ts
 * reads the stylesheet and fails if these drift from it.
 */
const DARK_CSS: Record<TokenName, string> = {
  "bg-base": "#1c1825",
  "bg-raised": "#221d2b",
  "bg-surface": "#2b2636",
  "bg-floating": "#282331",
  "bg-input": "#15121c",
  "bg-composer": "#2b2636",
  "bg-hover": "rgba(166, 156, 196, 0.08)",
  "bg-selected": "rgba(166, 156, 196, 0.13)",
  "bg-active": "rgba(166, 156, 196, 0.17)",
  "bg-message-hover": "rgba(166, 156, 196, 0.05)",
  "bg-overlay": "rgba(6, 3, 14, 0.74)",
  text: "#f0edf7",
  "text-strong": "#ffffff",
  "text-subtle": "#d0cadb",
  "text-muted": "#b0a8bf",
  "text-channel": "#a39bb3",
  "text-placeholder": "#928ba5",
  icon: "#bcb4cb",
  brand: "#8000ff",
  "brand-hover": "#6a00d6",
  "brand-active": "#5600ac",
  "on-brand": "#ffffff",
  "on-danger": "#ffffff",
  "on-positive": "#ffffff",
  "on-warning": "#111214",
  "focus-ring": "#b77aff",
  link: "#86b8f7",
  "text-brand": "#c6a4ff",
  "mention-bg": "rgba(128, 0, 255, 0.24)",
  "mention-bg-hover": "rgba(128, 0, 255, 0.38)",
  "mention-fg": "#e0d0ff",
  positive: "#2d8550",
  "positive-hover": "#256e42",
  warning: "#fdb833",
  "text-warning": "#fdb833",
  danger: "#d1343b",
  "danger-hover": "#b02a31",
  "text-danger": "#ff8a8e",
  "status-online": "#46b56e",
  "status-idle": "#f0b232",
  "status-dnd": "#ff7075",
  "status-offline": "#a39cb1",
  "border-subtle": "rgba(166, 156, 196, 0.11)",
  border: "rgba(166, 156, 196, 0.19)",
  "border-strong": "rgba(166, 156, 196, 0.4)",
  "scroll-thumb": "rgba(166, 156, 196, 0.24)",
  "scroll-thumb-hover": "rgba(166, 156, 196, 0.42)",
  spoiler: "#7d768a",
  "spoiler-revealed": "#15121c",
  "code-bg": "#15121c",
  "code-border": "rgba(166, 156, 196, 0.12)",
  "code-keyword": "#c678dd",
  "code-string": "#98c379",
  "code-number": "#d19a66",
  "code-comment": "#8d939e",
  "code-title": "#61afef",
  "code-type": "#e5c07b",
  "code-variable": "#e06c75",
  "embed-bg": "#272231",
  "tooltip-bg": "#0e0b14",
  "tooltip-text": "#f5f3fa",
};

const LIGHT_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#f4f2fb",
  "bg-raised": "#ffffff",
  "bg-surface": "#eae8f3",
  "bg-floating": "#ffffff",
  "bg-input": "#ebe9f4",
  "bg-composer": "#edebf5",
  "embed-bg": "#f5f3fb",
  "bg-overlay": "rgba(28, 18, 50, 0.46)",
  "bg-hover": "rgba(101, 94, 125, 0.09)",
  "bg-selected": "rgba(101, 94, 125, 0.14)",
  "bg-active": "rgba(101, 94, 125, 0.2)",
  "bg-message-hover": "rgba(101, 94, 125, 0.05)",
  "scroll-thumb": "rgba(101, 94, 125, 0.32)",
  "scroll-thumb-hover": "rgba(101, 94, 125, 0.52)",
  "text-strong": "#1f1c28",
  text: "#2e2c37",
  "text-subtle": "#595565",
  "text-muted": "#595667",
  "text-channel": "#5f5b6c",
  "text-placeholder": "#6c6877",
  icon: "#514d5f",
  link: "#0062c0",
  "text-brand": "#6a00d6",
  "focus-ring": "#8000ff",
  "mention-bg": "rgba(128, 0, 255, 0.16)",
  "mention-bg-hover": "rgba(128, 0, 255, 0.32)",
  "mention-fg": "#4a1a8f",
  "border-subtle": "rgba(141, 136, 162, 0.26)",
  border: "rgba(141, 136, 162, 0.38)",
  "border-strong": "rgba(141, 136, 162, 0.52)",
  positive: "#1f7d47",
  "positive-hover": "#196a3c",
  warning: "#bb7300",
  "text-warning": "#7a4b00",
  danger: "#d1343b",
  "danger-hover": "#b02a31",
  "text-danger": "#ab1e29",
  "status-online": "#2a7044",
  "status-idle": "#845a06",
  "status-dnd": "#c0222c",
  "status-offline": "#6b6776",
  "tooltip-bg": "#282336",
  "tooltip-text": "#f7f6fa",
  spoiler: "#93909e",
  "spoiler-revealed": "#eae8f3",
  "code-bg": "#f5f3fb",
  "code-border": "rgba(141, 136, 162, 0.26)",
  "code-keyword": "#cf222e",
  "code-string": "#0a3069",
  "code-number": "#0550ae",
  "code-comment": "#636b75",
  "code-title": "#7a3fd4",
  "code-type": "#116329",
  "code-variable": "#953800",
};

const ASH_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#18191d",
  "bg-raised": "#1d1e23",
  "bg-surface": "#27282e",
  "bg-floating": "#24252b",
  "bg-input": "#111215",
  "bg-composer": "#27282e",
  "embed-bg": "#24252b",
  "bg-overlay": "rgba(0, 0, 0, 0.72)",
  "bg-hover": "rgba(200, 202, 215, 0.07)",
  "bg-selected": "rgba(200, 202, 215, 0.12)",
  "bg-active": "rgba(200, 202, 215, 0.16)",
  "bg-message-hover": "rgba(200, 202, 215, 0.045)",
  "scroll-thumb": "rgba(200, 202, 215, 0.22)",
  "scroll-thumb-hover": "rgba(200, 202, 215, 0.4)",
  text: "#eeeef1",
  "text-subtle": "#cacbd2",
  "text-muted": "#aeafb8",
  "text-channel": "#9fa0aa",
  "text-placeholder": "#8c8e98",
  icon: "#b6b7c0",
  "border-subtle": "rgba(200, 202, 215, 0.1)",
  border: "rgba(200, 202, 215, 0.17)",
  "border-strong": "rgba(200, 202, 215, 0.36)",
  "text-danger": "#ff8d90",
  "status-offline": "#a0a1ab",
  "tooltip-bg": "#0b0b0d",
  spoiler: "#7c7d86",
  "spoiler-revealed": "#111215",
  "code-bg": "#111215",
  "code-border": "rgba(200, 202, 215, 0.1)",
};

const ONYX_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#000000",
  "bg-raised": "#000000",
  "bg-surface": "#141218",
  "bg-floating": "#16141b",
  "bg-input": "#0c0b10",
  "bg-composer": "#141218",
  "embed-bg": "#121016",
  "bg-hover": "rgba(255, 255, 255, 0.06)",
  "bg-selected": "rgba(255, 255, 255, 0.1)",
  "bg-active": "rgba(255, 255, 255, 0.14)",
  "bg-message-hover": "rgba(255, 255, 255, 0.04)",
  "text-strong": "#ffffff",
  text: "#dcdae0",
  "text-subtle": "#c4c1ca",
  "text-muted": "#a19eaa",
  "text-channel": "#96939f",
  "text-placeholder": "#86838f",
  "border-subtle": "rgba(255, 255, 255, 0.1)",
  border: "rgba(255, 255, 255, 0.16)",
  "border-strong": "rgba(255, 255, 255, 0.34)",
  "spoiler-revealed": "#141218",
  "code-bg": "#0c0b10",
};

/** The stylesheet's values for each classic theme, as it declares them (before normalising). */
export const CLASSIC_CSS: Record<ClassicTheme, Partial<Record<TokenName, string>>> = { dark: DARK_CSS, light: LIGHT_CSS, ash: ASH_CSS, onyx: ONYX_CSS };

function normaliseMap(m: Record<TokenName, string>): TokenMap {
  const out = {} as TokenMap;
  for (const t of TOKENS) out[t] = normaliseColour(m[t]) ?? m[t];
  return out;
}

/** The classic themes' full token sets: the dark one's, with each theme's own values over it, as the cascade does. */
export const CLASSIC: Record<ClassicTheme, TokenMap> = {
  dark: normaliseMap(DARK_CSS),
  light: normaliseMap({ ...DARK_CSS, ...LIGHT_CSS }),
  ash: normaliseMap({ ...DARK_CSS, ...ASH_CSS }),
  onyx: normaliseMap({ ...DARK_CSS, ...ONYX_CSS }),
};

export const CLASSIC_IDS: readonly ClassicTheme[] = ["dark", "light", "ash", "onyx"];
export const isClassic = (id: string): id is ClassicTheme => (CLASSIC_IDS as readonly string[]).includes(id);

/** A token map as CSS declarations, for a style element or a style attribute's text. */
export function declarations(tokens: Partial<Record<TokenName, string>>): string {
  return TOKENS.filter((t) => tokens[t]).map((t) => `--${t}:${tokens[t]}`).join(";");
}

/** A token map as a React style object, so one element and everything in it draws in that theme. */
export function tokenStyle(tokens: Partial<Record<TokenName, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TOKENS) if (tokens[t]) out[`--${t}`] = tokens[t]!;
  return out;
}
