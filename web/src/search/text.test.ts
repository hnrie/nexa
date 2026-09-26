import { describe, expect, it } from "vitest";
import { fold, foldWithMap, highlightRuns, termTokens, tokenize } from "./text";

const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe("folding", () => {
  it("drops case and the accents of Latin, Greek and Cyrillic", () => {
    expect(fold("Crème Brûlée")).toBe("creme brulee");
    expect(fold("ÉCOLE")).toBe("ecole");
    expect(fold("Ελληνικά")).toBe("ελληνικα");
    expect(fold("Ёлка")).toBe("елка");
    expect(fold("İstanbul")).toBe("istanbul");
  });

  it("reads wide letters, ligatures, ß and a final sigma as their plain forms", () => {
    expect(fold("ＡＢＣ")).toBe("abc");
    expect(fold("ﬁne")).toBe("fine");
    expect(fold("Straße")).toBe("strasse");
    expect(fold("ΟΔΟΣ")).toBe(fold("οδοσ"));
  });

  it("drops Arabic vowel marks and the stretch, but keeps the marks that make a word elsewhere", () => {
    expect(fold("مُحَمَّد")).toBe("محمد");
    expect(fold("كتـــاب")).toBe("كتاب");
    // a Devanagari vowel sign is part of the word
    expect(fold("किताब")).toBe("किताब");
    // and a Japanese voicing mark changes the word
    expect(fold("が")).not.toBe(fold("か"));
  });

  it("folds the same way with and without a map", () => {
    for (const s of ["Crème Brûlée", "Straße ΟΔΟΣ", "école", "مُحَمَّد and किताब", "東京に行きます", "ＡＢＣ ﬁ", "İ i̇", "q̃ü"]) {
      const withMap = foldWithMap(s);
      expect(withMap.folded).toBe(fold(withMap.shown));
      expect(withMap.map).toHaveLength(withMap.folded.length + 1);
    }
  });
});

describe("tokens", () => {
  it("cuts words at anything that is not a letter or a digit", () => {
    expect(texts(tokenize(fold("Hello, world! it's 2026-01-31 at chat.evilion.xyz")))).toEqual(["hello", "world", "it", "s", "2026", "01", "31", "at", "chat", "evilion", "xyz"]);
  });

  it("cuts Chinese and Japanese into characters and pairs", () => {
    expect(texts(tokenize("北京大学"))).toEqual(["北", "北京", "京", "京大", "大", "大学", "学"]);
    expect(texts(termTokens("北京"))).toEqual(["北京"]);
    expect(texts(termTokens("北"))).toEqual(["北"]);
    expect(texts(tokenize("abc北京"))).toEqual(["abc", "北", "北京", "京"]);
  });

  it("finds an Arabic word with its article joined on", () => {
    expect(texts(tokenize(fold("الكتاب")))).toEqual(["الكتاب", "كتاب"]);
  });

  it("keeps Korean words whole, found by their beginning", () => {
    const toks = tokenize("친구가 왔어요");
    expect(texts(toks)).toEqual(["친구가", "왔어요"]);
    expect(toks.every((t) => t.prefix)).toBe(true);
  });
});

describe("highlighting", () => {
  it("merges overlapping matches", () => {
    const runs = highlightRuns("needles", ["need", "needle"]);
    expect(runs).toEqual([
      { text: "needle", hit: true },
      { text: "s", hit: false },
    ]);
  });

  it("marks text written with combining accents", () => {
    const runs = highlightRuns("une école", ["ecole"]);
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["école"]);
  });

  it("gives the text back unmarked when nothing is asked for", () => {
    expect(highlightRuns("plain", [])).toEqual([{ text: "plain", hit: false }]);
    expect(highlightRuns("", ["x"])).toEqual([]);
  });
});
