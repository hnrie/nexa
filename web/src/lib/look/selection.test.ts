import { describe, expect, it } from "vitest";
import { blend, contrast, oklchToHex, parseColour, rgbToOklch, toHex } from "@/lib/color";
import { PRESETS, presetTokens } from "./presets";

/** A token's colour without its transparency (panels and text are solid). */
const solid = (value: string): string => toHex(parseColour(value)?.rgb ?? [0, 0, 0]);

/**
 * Selected text (--selection in styles/tokens.css, ::selection in base.css): on
 * a dark theme, the focus ring's hue at OKLCH lightness 0.5; on a light one, the
 * ring at 28% over the panel. Either way the words in it are drawn at
 * --text-strong. It has to stand out from the panel it is on, and the words in
 * it still have to read. The accent at 42%, which it was, came out nearly black
 * on Onyx: 1.3:1.
 */
describe("selected text", () => {
  for (const p of PRESETS) {
    it(`stands out in ${p.id}, with its words still readable`, () => {
      const t = presetTokens(p.id)!;
      const ring = parseColour(t["focus-ring"])!.rgb;
      for (const panel of ["bg-base", "bg-raised", "bg-surface", "bg-floating"] as const) {
        const under = solid(t[panel]);
        const o = rgbToOklch(ring);
        const selected = p.scheme === "light" ? toHex(blend(ring, under, 0.28)) : oklchToHex({ l: 0.5, c: o.c, h: o.h });
        expect(contrast(selected, under), `${p.id}: the highlight on ${panel}`).toBeGreaterThanOrEqual(p.scheme === "light" ? 1.3 : 2);
        expect(contrast(solid(t["text-strong"]), selected), `${p.id}: words in it on ${panel}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("was what made Onyx's hard to see", () => {
    const onyx = presetTokens("onyx")!;
    const old = toHex(blend(solid(onyx.brand), solid(onyx["bg-base"]), 0.42));
    expect(contrast(old, solid(onyx["bg-base"]))).toBeLessThan(1.5);
  });
});
