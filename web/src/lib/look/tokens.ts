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
  "bg-base": "#2c2936",
  "bg-raised": "#322f3d",
  "bg-surface": "#3b3847",
  "bg-floating": "#363342",
  "bg-input": "#23212c",
  "bg-composer": "#3b3847",
  "embed-bg": "#3b3847",
  "bg-overlay": "rgba(10, 6, 20, 0.72)",
  "bg-hover": "rgba(153, 148, 172, 0.08)",
  "bg-selected": "rgba(153, 148, 172, 0.13)",
  "bg-active": "rgba(153, 148, 172, 0.17)",
  "bg-message-hover": "rgba(153, 148, 172, 0.06)",
  "scroll-thumb": "rgba(153, 148, 172, 0.28)",
  "scroll-thumb-hover": "rgba(153, 148, 172, 0.45)",
  "text-strong": "#ffffff",
  text: "#f3f3f7",
  "text-subtle": "#cbc9d3",
  "text-muted": "#adaab7",
  "text-channel": "#9c99a7",
  "text-placeholder": "#6f6d79",
  icon: "#bbb8c6",
  link: "#76aff6",
  brand: "#8000ff",
  "brand-hover": "#6a00d6",
  "brand-active": "#5600ac",
  "on-brand": "#ffffff",
  "text-brand": "#c3a0ff",
  "focus-ring": "#b06bff",
  "mention-bg": "rgba(128, 0, 255, 0.26)",
  "mention-bg-hover": "rgba(128, 0, 255, 0.42)",
  "mention-fg": "#ddc9ff",
  "border-subtle": "rgba(153, 148, 172, 0.12)",
  border: "rgba(153, 148, 172, 0.2)",
  "border-strong": "rgba(153, 148, 172, 0.44)",
  positive: "#3d9e60",
  "positive-hover": "#2f7f4c",
  "on-positive": "#ffffff",
  warning: "#fdb833",
  "text-warning": "#fdb833",
  "on-warning": "#111214",
  danger: "#da3e44",
  "danger-hover": "#b5343a",
  "on-danger": "#ffffff",
  "text-danger": "#fc8387",
  "status-online": "#3d9e60",
  "status-idle": "#f0b232",
  "status-dnd": "#da3e44",
  "status-offline": "#85828f",
  "tooltip-bg": "#15121e",
  "tooltip-text": "#f5f4f9",
  spoiler: "#817e8b",
  "spoiler-revealed": "#23212c",
  "code-bg": "#23212c",
  "code-border": "rgba(153, 148, 172, 0.12)",
  "code-keyword": "#c678dd",
  "code-string": "#98c379",
  "code-number": "#d19a66",
  "code-comment": "#8d939e",
  "code-title": "#61afef",
  "code-type": "#e5c07b",
  "code-variable": "#e06c75",
};

const LIGHT_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#f4f2fb",
  "bg-raised": "#ffffff",
  "bg-surface": "#eae8f3",
  "bg-floating": "#ffffff",
  "bg-input": "#ebe9f4",
  "bg-composer": "#edebf5",
  "bg-hover": "rgba(101, 94, 125, 0.09)",
  "bg-selected": "rgba(101, 94, 125, 0.14)",
  "bg-active": "rgba(101, 94, 125, 0.2)",
  "bg-message-hover": "rgba(101, 94, 125, 0.05)",
  "bg-overlay": "rgba(28, 18, 50, 0.5)",
  text: "#2e2c37",
  "text-strong": "#1f1c28",
  "text-subtle": "#595565",
  "text-muted": "#6a6677",
  "text-channel": "#656272",
  "text-placeholder": "#878491",
  icon: "#514d5f",
  link: "#006dd4",
  "text-brand": "#6a00d6",
  "focus-ring": "#8000ff",
  "mention-bg": "rgba(128, 0, 255, 0.16)",
  "mention-bg-hover": "rgba(128, 0, 255, 0.32)",
  "mention-fg": "#4a1a8f",
  positive: "#269153",
  "positive-hover": "#1f7a45",
  warning: "#bb7300",
  "text-warning": "#8a5500",
  danger: "#d6363f",
  "danger-hover": "#b52d35",
  "text-danger": "#c33139",
  "status-online": "#307d4c",
  "status-idle": "#93660b",
  "status-dnd": "#d42b35",
  "status-offline": "#6b6776",
  "border-subtle": "rgba(141, 136, 162, 0.26)",
  border: "rgba(141, 136, 162, 0.38)",
  "border-strong": "rgba(141, 136, 162, 0.52)",
  "scroll-thumb": "rgba(101, 94, 125, 0.32)",
  "scroll-thumb-hover": "rgba(101, 94, 125, 0.52)",
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
  "embed-bg": "#f5f3fb",
  "tooltip-bg": "#282336",
  "tooltip-text": "#f7f6fa",
};

const ASH_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#1a1821",
  "bg-raised": "#211f29",
  "bg-surface": "#272430",
  "bg-floating": "#2a2733",
  "bg-input": "#131119",
  "bg-composer": "#272430",
  text: "#f0eff4",
  "text-muted": "#9f9ca9",
  "text-channel": "#8a8794",
  "spoiler-revealed": "#1a1821",
  "code-bg": "#131119",
  "embed-bg": "#272430",
  "text-danger": "#fb5b60",
};

const ONYX_CSS: Partial<Record<TokenName, string>> = {
  "bg-base": "#000000",
  "bg-raised": "#000000",
  "bg-surface": "#14121a",
  "bg-floating": "#16151d",
  "bg-input": "#0e0c12",
  "bg-composer": "#14121a",
  "bg-hover": "rgba(255, 255, 255, 0.06)",
  "bg-selected": "rgba(255, 255, 255, 0.1)",
  "bg-active": "rgba(255, 255, 255, 0.14)",
  "bg-message-hover": "rgba(255, 255, 255, 0.04)",
  text: "#d8d6dc",
  "text-strong": "#ffffff",
  "text-muted": "#8a8792",
  "text-channel": "#817e89",
  "border-subtle": "rgba(255, 255, 255, 0.1)",
  "spoiler-revealed": "#14121a",
  "code-bg": "#0e0c12",
  "embed-bg": "#14121a",
  "text-danger": "#fb5b60",
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
