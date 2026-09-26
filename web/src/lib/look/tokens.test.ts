import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSIC_CSS, TOKENS, TOKEN_GROUPS, normaliseColour } from "./tokens";

/** The custom properties a block of tokens.css declares, by name without the dashes. */
function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

describe("the classic themes' tokens", () => {
  const css = readFileSync(resolve(__dirname, "../../styles/tokens.css"), "utf8");
  // the first :root block is the stacking order; the palette is the second
  const rootAt = css.indexOf(":root {", css.indexOf(":root {") + 1);
  const root = block(css.slice(rootAt), ":root");
  const sheets = { dark: root, light: block(css, '[data-theme="light"]'), ash: block(css, '[data-theme="ash"]'), onyx: block(css, '[data-theme="onyx"]') };

  for (const [theme, declared] of Object.entries(sheets)) {
    it(`mirror what tokens.css declares for ${theme}`, () => {
      const mine = CLASSIC_CSS[theme as keyof typeof CLASSIC_CSS];
      for (const t of TOKENS) {
        if (!(t in declared)) {
          expect(mine[t], `${theme} ${t} is not in the stylesheet`).toBeUndefined();
          continue;
        }
        expect(normaliseColour(mine[t] ?? ""), `${theme} ${t}`).toBe(normaliseColour(declared[t]!));
      }
    });
  }

  it("cover every colour the stylesheet's dark palette has", () => {
    const colours = Object.entries(root).filter(([, v]) => normaliseColour(v) !== null && !v.includes("var("));
    const missing = colours.map(([k]) => k).filter((k) => !(TOKENS as readonly string[]).includes(k) && k !== "scroll-track");
    expect(missing).toEqual([]);
  });

  it("list each token once", () => {
    const all = TOKEN_GROUPS.flatMap((g) => g.tokens as readonly string[]);
    expect(new Set(all).size).toBe(all.length);
  });
});
