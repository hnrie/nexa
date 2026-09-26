import { describe, expect, it } from "vitest";
import { formatShortcut, toggleWrap, type Wrapped } from "./wrapShortcut";

/** The text after a toggle, with the selection marked as [ and ]. */
function after(text: string, start: number, end: number, marker: "**" | "*" | "__"): string {
  const w: Wrapped = toggleWrap(text, start, end, marker);
  const out = text.slice(0, w.from) + w.insert + text.slice(w.to);
  return out.slice(0, w.start) + "[" + out.slice(w.start, w.end) + "]" + out.slice(w.end);
}

/** Selects the part of `text` between [ and ] and toggles. */
function toggle(marked: string, marker: "**" | "*" | "__"): string {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return after(marked.replace("[", "").replace("]", ""), start, end, marker);
}

describe("the formatting shortcuts", () => {
  it("answers Ctrl or Cmd with B, I and U only", () => {
    const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
      formatShortcut({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
    expect(key("b", { ctrlKey: true })).toBe("**");
    expect(key("I", { metaKey: true })).toBe("*");
    expect(key("u", { ctrlKey: true })).toBe("__");
    expect(key("b")).toBeNull();
    expect(key("b", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(key("b", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("k", { ctrlKey: true })).toBeNull();
  });

  it("wraps the selection and keeps the words selected", () => {
    expect(toggle("say [hello] there", "**")).toBe("say **[hello]** there");
    expect(toggle("[x]", "*")).toBe("*[x]*");
    expect(toggle("[x]", "__")).toBe("__[x]__");
  });

  it("takes the format off again when pressed twice", () => {
    const once = toggleWrap("say hello", 4, 9, "**");
    const text = "say " + once.insert;
    const twice = toggleWrap(text, once.start, once.end, "**");
    expect(text.slice(0, twice.from) + twice.insert + text.slice(twice.to)).toBe("say hello");
  });

  it("unwraps a selection that has the format already", () => {
    expect(toggle("**[hello]**", "**")).toBe("[hello]");
    expect(toggle("[**hello**]", "**")).toBe("[hello]");
    expect(toggle("*[hello]*", "*")).toBe("[hello]");
    expect(toggle("__[hello]__", "__")).toBe("[hello]");
  });

  it("tells bold from italics", () => {
    expect(toggle("**[hello]**", "*")).toBe("***[hello]***");
    expect(toggle("***[hello]***", "*")).toBe("**[hello]**");
    expect(toggle("***[hello]***", "**")).toBe("*[hello]*");
    expect(toggle("*[hello]*", "**")).toBe("***[hello]***");
  });

  it("keeps spaces at the edges outside the markers", () => {
    expect(toggle("say[ hello ]there", "**")).toBe("say **[hello]** there");
    expect(toggle("[   ]", "**")).toBe("[   ]");
  });

  it("wraps each line on its own", () => {
    expect(toggle("[a\n\nb]", "**")).toBe("[**a**\n\n**b**]");
  });

  it("puts markers round the caret, and takes them away again", () => {
    expect(after("ab", 1, 1, "**")).toBe("a**[]**b");
    expect(after("a****b", 3, 3, "**")).toBe("a[]b");
    expect(after("a**b", 2, 2, "*")).toBe("a[]b");
  });
});
