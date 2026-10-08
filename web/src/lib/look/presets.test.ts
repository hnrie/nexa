import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { contrastIssues } from "./contrast";
import { PRESETS, presetById, presetCards, presetColours, presetTokens } from "./presets";
import { CLASSIC_IDS } from "./tokens";

const derived = PRESETS.filter((p) => !(CLASSIC_IDS as readonly string[]).includes(p.id));

describe("the gallery's themes", () => {
  it("has the classic four first, then the colour, light and plain ones", () => {
    expect(PRESETS.slice(0, 4).map((p) => p.id)).toEqual(["dark", "light", "ash", "onyx"]);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(derived.length).toBeGreaterThanOrEqual(15);
  });

  for (const p of derived) {
    it(`${p.id}: every text colour reads at AA or better where it is drawn`, () => {
      expect(contrastIssues(presetTokens(p.id)!)).toEqual([]);
    });
  }

  it("draws light themes light and dark themes dark", () => {
    for (const p of derived) {
      const t = presetTokens(p.id)!;
      const textOnPage = contrast(t.text, t["bg-raised"]);
      expect(textOnPage, p.id).toBeGreaterThanOrEqual(7);
      expect(p.scheme === "light" ? presetColours(p.id)!.scheme : "dark").toBe(p.scheme);
    }
  });

  it("underlines links where colour alone would not set them apart", () => {
    expect(presetById("greyscale")?.underlineLinks).toBe(true);
    expect(presetById("contrast")?.underlineLinks).toBe(true);
    expect(presetById("forest")?.underlineLinks).toBe(false);
  });

  it("shows a theme and its light version as one card, and every theme on some card", () => {
    const colours = presetCards(["dark", "light"]).map((c) => [c.preset.id, c.light?.id ?? null]);
    expect(colours).toEqual([
      ["nexa", "nexa-light"],
      ["midnight", null],
      ["forest", "forest-light"],
      ["rose", "rose-light"],
      ["amber", "amber-light"],
      ["ocean", "ocean-light"],
      ["sky", null],
    ]);
    expect(presetCards(["plain"]).map((c) => [c.light?.id, c.dark?.id])).toEqual([
      ["greyscale-light", "greyscale"],
      ["contrast-light", "contrast"],
    ]);
    // the classic Dark and Light stay cards of their own
    expect(presetCards(["classic"]).every((c) => c.light === null)).toBe(true);
    const shown = presetCards(["classic", "dark", "light", "plain"]).flatMap((c) => [c.preset.id, c.light?.id, c.dark?.id]);
    for (const p of PRESETS) expect(shown, p.id).toContain(p.id);
  });

  it("works a palette out once and hands the same one back", () => {
    expect(presetTokens("forest")).toBe(presetTokens("forest"));
    expect(presetTokens("nope")).toBeNull();
  });
});
