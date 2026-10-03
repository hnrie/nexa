import { describe, expect, it } from "vitest";
import { clampZalgo, hasZalgo } from "./zalgo";

const ZALGO = "H̵̡̛̤̺̖e̵͙͊́llo";

describe("zalgo", () => {
  it("finds letters buried under marks and cuts them back", () => {
    expect(hasZalgo(ZALGO)).toBe(true);
    const clamped = clampZalgo(ZALGO);
    expect(hasZalgo(clamped)).toBe(false);
    expect(clamped.startsWith("H̵̡̛")).toBe(true);
    expect(clamped.endsWith("llo")).toBe(true);
  });
  it("leaves what languages need alone", () => {
    for (const text of ["Tiếng Việt", "ệ", "café", "שָׁלוֹם", "مُحَمَّد", "हिंदी", "ภาษาไทย", "1️⃣", "plain text"]) {
      expect(hasZalgo(text)).toBe(false);
      expect(clampZalgo(text)).toBe(text);
    }
  });
});
