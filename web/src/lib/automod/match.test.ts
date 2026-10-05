import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matcher, fold } from "./match";

interface Vector {
  name: string;
  words: string[];
  regex: string[];
  allow: string[];
  evasion: boolean;
  text: string;
  match: string | null;
}

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../internal/automod/testdata/vectors.json", import.meta.url)), "utf8")) as Vector[];

describe("AutoMod matching", () => {
  // the same cases the server and the Android app answer
  for (const v of vectors) {
    it(v.name, () => {
      expect(new Matcher(v.words, v.regex, v.allow, v.evasion).match(v.text)).toBe(v.match);
    });
  }

  it("folds disguises away", () => {
    expect(fold("Ｈéllo Wörld")).toBe("hello world");
    expect(fold("f.u.c.k this")).toBe("fuck this");
  });
});
