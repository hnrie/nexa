import { describe, expect, it } from "vitest";
import { rank, typoDistance } from "./rank";

describe("typoDistance", () => {
  it("counts two swapped letters as half a slip", () => {
    expect(typoDistance("tset", "test")).toBe(0.5);
    expect(typoDistance("teh", "the")).toBe(0.5);
  });

  it("counts a letter added, dropped or changed as one, whatever the capitals", () => {
    expect(typoDistance("chek", "check")).toBe(1);
    expect(typoDistance("Ths", "this")).toBe(1);
    expect(typoDistance("cat", "cut")).toBe(1);
  });
});

describe("rank", () => {
  it("puts the nearest typo first, then words with the same first letter, then the dictionary's order", () => {
    expect(rank("tset", ["set", "stet", "test", "Tet"])).toEqual(["test", "stet", "Tet", "set"]);
    expect(rank("teh", ["eh", "tech", "the", "ten"])).toEqual(["the", "tech", "ten", "eh"]);
  });
});
