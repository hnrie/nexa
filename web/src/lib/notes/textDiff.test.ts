import { applyDelta, textDelta } from "./textDiff";

const pairs: [string, string][] = [
  ["", "hello"],
  ["hello", ""],
  ["hello world", "hello brave world"],
  ["word", "**word**"],
  ["one two three", "one 2 three"],
  ["abc", "xyz"],
  ["The cat sat.", "The black cat sat down."],
  ["😀 smile", "😃 smile"],
  ["a😀b", "a😀😀b"],
  ["line one\nline two\nline three", "line one\nline 2\nline three\nline four"],
  ["- [ ] milk\n- [ ] eggs", "- [x] milk\n- [ ] eggs\n- [ ] bread"],
];

describe("textDelta", () => {
  it.each(pairs)("turns %j into %j", (a, b) => {
    expect(applyDelta(a, textDelta(a, b))).toBe(b);
  });

  it("says nothing changed when nothing did", () => {
    expect(textDelta("same", "same")).toEqual([]);
  });

  it("keeps a word that was only made bold, rather than taking it out and putting it back", () => {
    const d = textDelta("make word bold", "make **word** bold");
    expect(d.some((s) => "delete" in s)).toBe(false);
    expect(d.filter((s) => "insert" in s).map((s) => (s as { insert: string }).insert)).toEqual(["**", "**"]);
  });

  it("never cuts a character in half", () => {
    // the two faces share their first half in UTF-16
    const d = textDelta("😀", "😃");
    expect(d).toEqual([{ delete: 2 }, { insert: "😃" }]);
  });

  it("handles a long paste without comparing it letter by letter", () => {
    const a = "x".repeat(5000);
    const b = "y".repeat(5000);
    const start = performance.now();
    expect(applyDelta(a, textDelta(a, b))).toBe(b);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("agrees with itself on random edits", () => {
    const letters = "ab c\n😀";
    for (let i = 0; i < 300; i++) {
      const rand = (n: number) => Array.from({ length: Math.floor(Math.random() * n) }, () => Array.from(letters)[Math.floor(Math.random() * 6)]).join("");
      const a = rand(40);
      const b = rand(40);
      expect(applyDelta(a, textDelta(a, b))).toBe(b);
    }
  });
});
