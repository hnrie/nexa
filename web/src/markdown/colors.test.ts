import { describe, expect, it } from "vitest";
import { contrast, parseHex, toHex, type Rgb } from "@/lib/color";
import { COLOR_NAMES, colorToken, cssColor, formatColorSpec, paintColor, PALETTE, parseColorSpec, swatchColor, type Surface } from "./colors";

/** Every panel of every built-in theme, with the text colour it carries (tokens.css). */
const THEMES: Record<string, { panels: string[]; text: string }> = {
  dark: { panels: ["#1c1825", "#221d2b", "#2b2636", "#282331"], text: "#f0edf7" },
  light: { panels: ["#f4f2fb", "#ffffff", "#eae8f3"], text: "#2e2c37" },
  ash: { panels: ["#18191d", "#1d1e23", "#27282e", "#24252b"], text: "#eeeef1" },
  onyx: { panels: ["#000000", "#141218", "#16141b"], text: "#dcdae0" },
};

const rgb = (hex: string): Rgb => parseHex(hex)!;
const surface = (bg: string, text: string): Surface => ({ bg: rgb(bg), text: rgb(text) });

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the colour syntax", () => {
  it("knows the palette, grey as gray, and hex codes", () => {
    expect(colorToken("Red")).toBe("red");
    expect(colorToken("grey")).toBe("gray");
    expect(colorToken("#ABC")).toBe("#aabbcc");
    expect(colorToken("#a1b2c3")).toBe("#a1b2c3");
    expect(colorToken("#abcd")).toBeNull();
    expect(colorToken("crimson")).toBeNull();
    expect(colorToken("")).toBeNull();
  });

  it("reads a text colour, a highlight, or both", () => {
    expect(parseColorSpec("red")).toEqual({ fg: "red", bg: null });
    expect(parseColorSpec(" on  yellow ")).toEqual({ fg: null, bg: "yellow" });
    expect(parseColorSpec("#fff on blue")).toEqual({ fg: "#ffffff", bg: "blue" });
    expect(parseColorSpec("on")).toBeNull();
    expect(parseColorSpec("red yellow")).toBeNull();
    expect(parseColorSpec("red on")).toBeNull();
    expect(parseColorSpec("red on yellow on blue")).toBeNull();
  });

  it("writes back what it reads", () => {
    for (const spec of ["red", "on yellow", "#123456 on gray"]) expect(formatColorSpec(parseColorSpec(spec)!)).toBe(spec);
  });
});

describe("the readability guard", () => {
  it("has a shade of every name that reads on every panel before any tuning", () => {
    for (const name of COLOR_NAMES) {
      for (const [theme, { panels }] of Object.entries(THEMES)) {
        const shade = theme === "light" ? PALETTE[name].light : PALETTE[name].dark;
        for (const panel of panels) expect(contrast(shade, panel), `${name} on ${theme} ${panel}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("paints every name readably on every theme, and a named colour is left as designed", () => {
    for (const name of COLOR_NAMES) {
      for (const [theme, { panels, text }] of Object.entries(THEMES)) {
        for (const panel of panels) {
          const painted = paintColor({ fg: name, bg: null }, surface(panel, text));
          expect(contrast(painted.color!, panel), `${name} on ${theme}`).toBeGreaterThanOrEqual(4.5);
          expect(painted.color).toBe(theme === "light" ? PALETTE[name].light : PALETTE[name].dark);
        }
      }
    }
  });

  it("keeps any hex code readable on any background", () => {
    const rand = mulberry32(0x5eed);
    const hex = () => toHex([rand() * 255, rand() * 255, rand() * 255]);
    for (let n = 0; n < 2000; n++) {
      const bg = hex();
      const fg = hex();
      const painted = paintColor({ fg, bg: null }, surface(bg, "#ffffff"));
      expect(contrast(painted.color!, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the hue of a colour it has to move", () => {
    // navy on onyx's black is lifted, pale yellow on white is darkened: both stay themselves
    const navy = paintColor({ fg: "#000080", bg: null }, surface("#000000", "#d4d5d8")).color!;
    expect(contrast(navy, "#000000")).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = rgb(navy);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    const pale = paintColor({ fg: "#ffff99", bg: null }, surface("#ffffff", "#2e2e34")).color!;
    expect(contrast(pale, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    const [pr, pg, pb] = rgb(pale);
    expect(Math.min(pr, pg)).toBeGreaterThan(pb);
  });

  it("gives every highlight text that reads on it, on every theme", () => {
    const rand = mulberry32(0xbead);
    const hexes = Array.from({ length: 200 }, () => toHex([rand() * 255, rand() * 255, rand() * 255]));
    for (const [theme, { panels, text }] of Object.entries(THEMES)) {
      for (const panel of panels) {
        for (const bg of [...COLOR_NAMES, ...hexes]) {
          const painted = paintColor({ fg: null, bg }, surface(panel, text));
          const ink = painted.color ?? text;
          expect(contrast(ink, painted.background!), `on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
          const both = paintColor({ fg: "red", bg }, surface(panel, text));
          expect(contrast(both.color!, both.background!), `red on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps the theme's own text colour on a highlight whenever it reads", () => {
    const painted = paintColor({ fg: null, bg: "yellow" }, surface("#2c2d32", "#f3f3f4"));
    expect(painted.color).toBeNull();
    expect(painted.background).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("draws swatches in the colour a message would get", () => {
    expect(swatchColor("blue", surface("#f3f3f4", "#2e2e34"))).toBe(PALETTE.blue.light);
    expect(swatchColor("blue", surface("#2c2d32", "#f3f3f4"))).toBe(PALETTE.blue.dark);
  });
});

describe("reading colours off the page", () => {
  it("understands what computed styles give back", () => {
    expect(cssColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(cssColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(cssColor("rgb(10 20 30 / 25%)")).toEqual([10, 20, 30, 0.25]);
    expect(cssColor("color(srgb 1 0.5 0 / 0.08)")).toEqual([255, 127.5, 0, 0.08]);
    expect(cssColor("#2c2d32")).toEqual([44, 45, 50, 1]);
    expect(cssColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(cssColor("")).toBeNull();
  });
});
