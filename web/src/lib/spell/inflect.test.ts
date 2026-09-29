import { describe, expect, it } from "vitest";
import { pluralStems } from "./inflect";

describe("pluralStems", () => {
  it("finds the noun a plural was made from", () => {
    expect(pluralStems("detections")).toContain("detection");
    expect(pluralStems("Integrations")).toContain("integration");
    expect(pluralStems("categories")).toContain("category");
    expect(pluralStems("switches")).toContain("switch");
  });

  it("offers no stem shorter than four letters, so slips like thes and ands stay wrong", () => {
    expect(pluralStems("thes")).toEqual([]);
    expect(pluralStems("ands")).toEqual([]);
  });

  it("leaves words ending in ss and possessives alone", () => {
    expect(pluralStems("business")).toEqual([]);
    expect(pluralStems("nora's")).toEqual([]);
  });
});
