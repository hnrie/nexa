import { contrast, ensureContrast, flatten, hexToOklch, oklchToHex, parseColour, toHex } from "@/lib/color";
import type { TokenMap, TokenName } from "./tokens";

/**
 * What has to read on what. The same rules check the gallery's presets in the
 * tests and warn in the theme builder, so a theme that passes here passes
 * everywhere the app draws it. A background is a token, or a see-through
 * token as it looks laid over a solid one (a row under the pointer).
 */

export type Backdrop = TokenName | readonly [over: TokenName, under: TokenName];

export interface Rule {
  token: TokenName;
  on: readonly Backdrop[];
  /** WCAG 2.x ratio: 4.5 for text, 3 for icons and rings. */
  min: number;
}

const PANELS: readonly Backdrop[] = ["bg-base", "bg-raised", "bg-surface", "bg-floating", "bg-input", "bg-composer", "embed-bg", "spoiler-revealed"];
const LIT: readonly Backdrop[] = [["bg-selected", "bg-base"], ["bg-active", "bg-surface"], ["bg-message-hover", "bg-raised"], ["bg-hover", "bg-floating"], ["mention-bg", "bg-raised"]];
const EVERYWHERE = [...PANELS, ...LIT];
const READING: readonly Backdrop[] = ["bg-raised", "bg-surface", "bg-floating", "embed-bg", ["bg-message-hover", "bg-raised"]];
const SIDEBAR: readonly Backdrop[] = ["bg-base", ["bg-selected", "bg-base"], ["bg-hover", "bg-base"]];
const STATUS: readonly Backdrop[] = ["bg-raised", "bg-base", "bg-surface", "bg-floating"];

export const RULES: readonly Rule[] = [
  { token: "text-strong", on: EVERYWHERE, min: 4.5 },
  { token: "text", on: EVERYWHERE, min: 4.5 },
  { token: "text-subtle", on: EVERYWHERE, min: 4.5 },
  { token: "text-muted", on: EVERYWHERE, min: 4.5 },
  { token: "text-channel", on: SIDEBAR, min: 4.5 },
  { token: "text-placeholder", on: ["bg-input", "bg-composer"], min: 4.5 },
  { token: "icon", on: EVERYWHERE, min: 3 },
  { token: "link", on: READING, min: 4.5 },
  { token: "text-brand", on: PANELS, min: 4.5 },
  { token: "focus-ring", on: PANELS, min: 3 },
  { token: "mention-fg", on: [["mention-bg", "bg-raised"], ["mention-bg-hover", "bg-raised"]], min: 4.5 },
  { token: "on-brand", on: ["brand", "brand-hover", "brand-active"], min: 4.5 },
  { token: "on-positive", on: ["positive", "positive-hover"], min: 4.5 },
  { token: "on-danger", on: ["danger", "danger-hover"], min: 4.5 },
  { token: "on-warning", on: ["warning"], min: 4.5 },
  { token: "text-danger", on: EVERYWHERE, min: 4.5 },
  { token: "text-warning", on: EVERYWHERE, min: 4.5 },
  { token: "status-online", on: STATUS, min: 4.5 },
  { token: "status-idle", on: STATUS, min: 4.5 },
  { token: "status-dnd", on: STATUS, min: 4.5 },
  { token: "status-offline", on: STATUS, min: 4.5 },
  { token: "tooltip-text", on: ["tooltip-bg"], min: 4.5 },
  { token: "code-keyword", on: ["code-bg"], min: 4.5 },
  { token: "code-string", on: ["code-bg"], min: 4.5 },
  { token: "code-number", on: ["code-bg"], min: 4.5 },
  { token: "code-comment", on: ["code-bg"], min: 4.5 },
  { token: "code-title", on: ["code-bg"], min: 4.5 },
  { token: "code-type", on: ["code-bg"], min: 4.5 },
  { token: "code-variable", on: ["code-bg"], min: 4.5 },
];

/** The solid colour a backdrop is, in this theme. */
export function backdropColour(tokens: TokenMap, b: Backdrop): string {
  if (typeof b === "string") return flatten(tokens[b], "#000000");
  return flatten(tokens[b[0]], flatten(tokens[b[1]], "#000000"));
}

export interface Issue {
  token: TokenName;
  /** The worst ratio found, and where. */
  ratio: number;
  min: number;
  against: Backdrop;
}

/** Every token that does not read where it is drawn, worst case first per token. */
export function contrastIssues(tokens: TokenMap): Issue[] {
  const worst = new Map<TokenName, Issue>();
  for (const rule of RULES) {
    const fg = flatten(tokens[rule.token], backdropColour(tokens, rule.on[0]!));
    for (const b of rule.on) {
      const ratio = contrast(fg, backdropColour(tokens, b));
      if (ratio + 1e-9 >= rule.min) continue;
      const have = worst.get(rule.token);
      // judged by how far short it falls, so a 4.4 against 4.5 is not listed ahead of a 2.1 against 3
      if (!have || ratio / rule.min < have.ratio / have.min) worst.set(rule.token, { token: rule.token, ratio, min: rule.min, against: b });
    }
  }
  return [...worst.values()];
}

/**
 * The same theme with every issue it can mend mended: each failing colour
 * moved lighter or darker, hue kept, until it reads everywhere it has to. A
 * label on a fill that no text colour can read on (a mid-grey button) gets its
 * fill moved instead.
 */
export function fixContrast(tokens: TokenMap): TokenMap {
  const out = { ...tokens };
  for (let pass = 0; pass < 2; pass++) {
    for (const rule of RULES) {
      const bgs = rule.on.map((b) => backdropColour(out, b));
      const current = parseColour(out[rule.token]);
      if (!current) continue;
      const fg = toHex(current.rgb);
      if (bgs.every((bg) => contrast(fg, bg) >= rule.min)) continue;
      const tuned = ensureContrast(fg, bgs, rule.min);
      out[rule.token] = tuned;
      if (bgs.every((bg) => contrast(tuned, bg) >= rule.min)) continue;
      // no text colour works on all of these fills: move each failing fill away from the text instead
      for (const b of rule.on) {
        if (typeof b !== "string" || contrast(tuned, backdropColour(out, b)) >= rule.min) continue;
        const o = hexToOklch(toHex(parseColour(out[b])!.rgb))!;
        const away = (hexToOklch(tuned)?.l ?? 1) > o.l ? -1 : 1;
        let l = o.l;
        for (let i = 0; i < 50 && contrast(tuned, oklchToHex({ ...o, l })) < rule.min; i++) l += away * 0.02;
        out[b] = oklchToHex({ ...o, l });
      }
    }
  }
  return out;
}
