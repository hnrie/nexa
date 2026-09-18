import { describe, expect, it } from "vitest";
import { blend, contrast, luminance, parseHex, readableOn, toHex, tuneForContrast, withAlpha } from "./color";
import { accentVars, SURFACE_BG } from "./theme";

/** The ten the Appearance page offers, and the four the audit found unreadable. */
const PRESETS = ["#8000ff", "#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#3498db", "#e91e63"];
const THEMES = ["dark", "light", "ash", "onyx"] as const;

/** A spread over the whole cube, so nothing here holds only for the presets. */
function everyColour(): string[] {
  const out: string[] = [];
  for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) out.push(toHex([r, g, b]));
  return out;
}

describe("contrast maths", () => {
  it("puts black at 0 and white at 1", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("agrees with WCAG's own worked examples", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#8000ff", "#ffffff")).toBeCloseTo(6.25, 2);
  });

  it("does not care which way round the pair is given", () => {
    expect(contrast("#fdb833", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#fdb833"), 10);
  });

  it("reads three- and six-digit hex, with or without the hash", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("8000ff")).toEqual([128, 0, 255]);
    expect(parseHex("nope")).toBeNull();
  });

  it("composites the way a screen does", () => {
    expect(toHex(blend("#ffffff", "#000000", 0.5))).toBe("#808080");
    expect(withAlpha("#8000ff", 0.24)).toBe("rgb(128 0 255 / 0.24)");
  });
});

describe("readableOn", () => {
  it("clears AA for body text against any colour at all", () => {
    for (const c of everyColour()) expect(contrast(c, readableOn(c))).toBeGreaterThanOrEqual(4.5);
  });

  it("is worst where black and white are equally far away, and still passes there", () => {
    // luminance 0.179 is where the two choices meet; nothing can do better than 4.58:1
    const crossover = everyColour().reduce((worst, c) => Math.min(worst, contrast(c, readableOn(c))), 21);
    expect(crossover).toBeGreaterThan(4.5);
    expect(crossover).toBeLessThan(5);
  });

  it("goes white on a dark fill and dark on a light one", () => {
    expect(readableOn("#8000ff")).toBe("#ffffff");
    expect(readableOn("#fdb833")).not.toBe("#ffffff");
    expect(readableOn("#ffffff")).not.toBe("#ffffff");
  });

  it("answers the four presets the audit measured as white-on-pale", () => {
    for (const c of ["#fdb833", "#1abc9c", "#3d9e60", "#3498db"]) {
      expect(contrast(c, "#ffffff")).toBeLessThan(4.5); // the bug
      expect(contrast(c, readableOn(c))).toBeGreaterThanOrEqual(4.5); // the fix
    }
  });
});

describe("tuneForContrast", () => {
  it("leaves a colour alone when it already reads", () => {
    expect(tuneForContrast("#ffffff", "#000000", 4.5)).toBe("#ffffff");
  });

  it("moves a colour until it reads, from either direction", () => {
    expect(contrast(tuneForContrast("#8000ff", "#2c2d32", 3), "#2c2d32")).toBeGreaterThanOrEqual(3);
    expect(contrast(tuneForContrast("#fdb833", "#f3f3f4", 4.5), "#f3f3f4")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tuneForContrast("#111214", "#000000", 4.5), "#000000")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accentVars", () => {
  const cases = PRESETS.concat(["#ffffff", "#000000", "#7f7f7f", "#00ff00", "#123456"]);

  it("refuses anything that is not a colour", () => {
    expect(accentVars("not a colour", "dark")).toBeNull();
  });

  it("keeps the colour that was picked", () => {
    expect(accentVars("#fdb833", "dark")?.["--brand"]).toBe("#fdb833");
  });

  for (const theme of THEMES) {
    it(`gives every accent a readable foreground and ring in the ${theme} theme`, () => {
      for (const accent of cases) {
        const v = accentVars(accent, theme)!;
        const surface = SURFACE_BG[theme];
        expect(contrast(v["--brand"]!, v["--on-brand"]!), `${accent} button text`).toBeGreaterThanOrEqual(4.5);
        // the same text has to survive the fill going darker or lighter under the pointer
        expect(contrast(v["--brand-hover"]!, v["--on-brand"]!), `${accent} hover`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v["--brand-active"]!, v["--on-brand"]!), `${accent} active`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v["--focus-ring"]!, surface), `${accent} focus ring`).toBeGreaterThanOrEqual(3);
        expect(contrast(v["--text-brand"]!, surface), `${accent} brand text`).toBeGreaterThanOrEqual(4.5);
        const pill = toHex(blend(v["--brand"]!, surface, theme === "light" ? 0.32 : 0.42));
        expect(contrast(v["--mention-fg"]!, pill), `${accent} mention`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("brightens rather than darkens an accent that has no room below it", () => {
    const v = accentVars("#12061f", "dark")!;
    expect(luminance(v["--brand-hover"]!)).toBeGreaterThan(luminance(v["--brand"]!));
  });

  it("still darkens an ordinary accent on hover, as it always did", () => {
    const v = accentVars("#8000ff", "dark")!;
    expect(luminance(v["--brand-hover"]!)).toBeLessThan(luminance(v["--brand"]!));
  });

  it("holds for colours nobody shipped, because the picker takes any of them", () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const accent = toHex([r, g, b]);
          for (const theme of THEMES) {
            const v = accentVars(accent, theme)!;
            const surface = SURFACE_BG[theme];
            expect(contrast(v["--brand"]!, v["--on-brand"]!), `${accent} ${theme}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(v["--brand-hover"]!, v["--on-brand"]!), `${accent} ${theme} hover`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(v["--brand-active"]!, v["--on-brand"]!), `${accent} ${theme} active`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(v["--focus-ring"]!, surface), `${accent} ${theme} ring`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});
