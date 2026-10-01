import { describe, expect, it } from "vitest";
import { readCursor, sameMark } from "./cursors";
import { PERSON_HUES, forgetHues, personHue } from "./people";

describe("a cursor from someone else", () => {
  const place = { b: 2, o: 5, k: "abc" };
  it("is taken when it is the shape a cursor has", () => {
    expect(readCursor({ s: "tab-1", a: place, f: { ...place, o: 9 } })).toEqual({ s: "tab-1", a: place, f: { ...place, o: 9 } });
    expect(readCursor({ s: "tab-1", gone: true })).toEqual({ s: "tab-1", gone: true });
    expect(readCursor({ s: "tab-1", a: { ...place, cell: [1, 2] }, f: place })).toEqual({ s: "tab-1", a: { ...place, cell: [1, 2] }, f: place });
  });

  it("is dropped when it is anything else", () => {
    for (const bad of [null, "x", [], { a: place, f: place }, { s: "!", a: place, f: place }, { s: "tab-1", a: place }, { s: "tab-1", a: { ...place, b: -1 }, f: place }, { s: "tab-1", a: { ...place, o: 1.5 }, f: place }, { s: "tab-1", a: { ...place, k: 5 }, f: place }, { s: "tab-1", a: { ...place, k: "x".repeat(40) }, f: place }, { s: "tab-1", a: { ...place, cell: [1] }, f: place }, { s: "tab-1", gone: "yes" }]) {
      expect(readCursor(bad)).toBeNull();
    }
  });

  it("is the same as another when it says the same", () => {
    expect(sameMark({ a: place, f: place }, { a: { ...place }, f: { ...place } })).toBe(true);
    expect(sameMark({ a: place, f: place }, { a: place, f: { ...place, o: 6 } })).toBe(false);
    expect(sameMark(null, null)).toBe(true);
  });
});

describe("the colours people have in a note", () => {
  it("are their own, stay theirs, and differ inside one note", () => {
    forgetHues();
    const people = Array.from({ length: 8 }, (_, i) => `1000${i}`);
    const hues = people.map((p) => personHue("note", p));
    expect(new Set(hues).size).toBe(8);
    for (const h of hues) expect(PERSON_HUES).toContain(h);
    // asked again, the same
    expect(people.map((p) => personHue("note", p))).toEqual(hues);
    // past eight there is no free one left, and somebody shares
    expect(PERSON_HUES).toContain(personHue("note", "999"));
  });
});
