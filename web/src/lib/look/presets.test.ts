import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { contrastIssues } from "./contrast";
import { PRESETS, presetById, presetColours, presetTokens } from "./presets";
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

  it("works a palette out once and hands the same one back", () => {
    expect(presetTokens("forest")).toBe(presetTokens("forest"));
    expect(presetTokens("nope")).toBeNull();
  });
});
