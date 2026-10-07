/**
 * The shapes the "look" settings are saved in: custom themes, custom CSS and
 * plugins. They travel in the account's encrypted settings blob, which every
 * device of the account reads, so every field here is checked on the way in
 * (sanitize.ts) rather than trusted.
 */

export type Scheme = "dark" | "light";

/** The four themes tokens.css draws on its own. */
export type ClassicTheme = "dark" | "light" | "ash" | "onyx";

/** A few colours the rest of a theme is worked out from (derive.ts). */
export interface SimpleColours {
  /** Behind the messages: the largest area on screen. */
  background: string;
  /** Buttons, mentions and whatever is selected. */
  accent: string;
  /** The main text colour, or null to have it worked out from the background. */
  text: string | null;
  scheme: Scheme;
}

export interface CustomTheme {
  /** "custom-" and eight letters or digits; `theme` names it by this. */
  id: string;
  name: string;
  /** Where the colours start: a few picked ones, or one of the built-in themes. */
  source: ({ kind: "simple" } & SimpleColours) | { kind: "preset"; id: string };
  /** Colours set one by one in the advanced editor, laid over what the source gives. Token name without the dashes. */
  overrides: Record<string, string>;
}

/** A stylesheet loaded from a link. Its text is kept on each device (cache.ts), never in the settings. */
export interface CssLink {
  id: string;
  url: string;
  enabled: boolean;
  addedAt: number;
}

export interface CustomCss {
  /** The person's own CSS, packed (pack.ts). */
  snippet: string;
  snippetOn: boolean;
  links: CssLink[];
}

export interface PluginMeta {
  name: string;
  description: string;
  version: string;
  author: string;
}

export interface PluginEntry {
  id: string;
  /** Where the code came from: a link, or pasted in. */
  source: "url" | "code";
  url: string | null;
  /** Pasted code, packed (pack.ts); null for a plugin loaded from a link, whose code lives on each device. */
  code: string | null;
  /** SHA-256 of the code that was approved, in hex. Nothing else is ever run for this entry. */
  hash: string;
  enabled: boolean;
  /** Values for the plugin's own settings, by key. */
  settings: Record<string, unknown>;
  /** What the plugin said about itself the last time it ran, to name it before it runs again. */
  meta: PluginMeta | null;
  /**
   * The permissions the person granted a plugin of API version 2
   * (plugins/permissions.ts). Absent or null for a version 1 plugin, which
   * asks for none and has the whole of its own API.
   */
  permissions?: string[] | null;
  addedAt: number;
}
