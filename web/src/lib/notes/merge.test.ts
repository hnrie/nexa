import { describe, expect, it } from "vitest";
import { merge3 } from "./merge";

describe("merge3", () => {
  it("takes whichever side changed, when only one did", () => {
    expect(merge3("a\nb\n", "a\nb\n", "a\nB\n")).toBe("a\nB\n");
    expect(merge3("a\nb\n", "A\nb\n", "a\nb\n")).toBe("A\nb\n");
    expect(merge3("a", "a", "a")).toBe("a");
    expect(merge3("", "", "new")).toBe("new");
    expect(merge3("old", "", "old")).toBe("");
  });

  it("keeps both sides' changes to different lines", () => {
    const base = "title\n\nfirst paragraph\n\nsecond paragraph\n";
    const mine = "title\n\nfirst paragraph, edited by me\n\nsecond paragraph\n";
    const theirs = "title\n\nfirst paragraph\n\nsecond paragraph\n\na third, from them\n";
    expect(merge3(base, mine, theirs)).toBe("title\n\nfirst paragraph, edited by me\n\nsecond paragraph\n\na third, from them\n");
  });

  it("keeps lines both added in different places, and lines either took away", () => {
    const base = "one\ntwo\nthree\nfour\n";
    expect(merge3(base, "zero\none\ntwo\nthree\nfour\n", "one\ntwo\nthree\nfour\nfive\n")).toBe("zero\none\ntwo\nthree\nfour\nfive\n");
    expect(merge3(base, "one\nthree\nfour\n", "one\ntwo\nthree\n")).toBe("one\nthree\n");
  });

  it("takes a change both made the same way once", () => {
    expect(merge3("colour\n", "color\n", "color\n")).toBe("color\n");
    expect(merge3("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\nd\n")).toBe("a\nX\nc\nd\n");
  });

  it("merges two changes to different words of one line", () => {
    expect(merge3("the quick brown fox jumps\n", "the slow brown fox jumps\n", "the quick brown fox leaps\n")).toBe("the slow brown fox leaps\n");
  });

  it("keeps both when the same words were changed differently, losing neither", () => {
    const out = merge3("meet at noon\n", "meet at one\n", "meet at two\n");
    expect(out).toBe("meet at one\nmeet at two\n");
    // with no line break at the end of the note, the two still land on lines of their own
    expect(merge3("x", "mine", "theirs")).toBe("mine\ntheirs");
  });

  it("keeps a line one side edited when the other deleted the lines around it", () => {
    const base = "a\nb\nc\n";
    const out = merge3(base, "a\nb edited\nc\n", "a\n");
    expect(out).toContain("b edited");
  });

  it("never loses a line that only one side wrote, whatever else changed", () => {
    // a small fixed-seed shuffle of edits; every line unique to one side must survive
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 300; n++) {
      const base = Array.from({ length: 12 }, (_, i) => `line ${i}`);
      const edit = (tag: string) => {
        const out = base.slice();
        for (let k = 0; k < 3; k++) {
          const at = Math.floor(rand() * (out.length + 1));
          const roll = rand();
          if (roll < 0.5) out.splice(at, 0, `${tag} added ${n}.${k}`);
          else if (roll < 0.8 && at < out.length) out.splice(at, 1);
          else if (at < out.length) out[at] = `${tag} wrote over ${n}.${k}`;
        }
        return out;
      };
      const mine = edit("mine");
      const theirs = edit("theirs");
      const merged = merge3(base.join("\n") + "\n", mine.join("\n") + "\n", theirs.join("\n") + "\n");
      for (const line of [...mine, ...theirs]) {
        if (line.startsWith("line ")) continue;
        expect(merged.split("\n"), `round ${n}: ${line}`).toContain(line);
      }
    }
  });

  it("handles a long note quickly", () => {
    const base = Array.from({ length: 6000 }, (_, i) => `paragraph number ${i} of a long note`).join("\n");
    const mine = base.replace("paragraph number 10 ", "PARAGRAPH TEN ");
    const theirs = base.replace("paragraph number 5990 ", "paragraph 5990, changed ");
    const started = performance.now();
    const out = merge3(base, mine, theirs);
    expect(out).toContain("PARAGRAPH TEN");
    expect(out).toContain("paragraph 5990, changed");
    expect(out.split("\n")).toHaveLength(6000);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
