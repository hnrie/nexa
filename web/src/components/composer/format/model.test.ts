import { describe, expect, it } from "vitest";
import { toMarkdown } from "./markdown";
import {
  caret,
  clearFormatting,
  deleteRange,
  editTable,
  emptyTable,
  indentBy,
  insertAt,
  insertBlock,
  isText,
  isVoid,
  joinBackward,
  joinForward,
  mapSelection,
  marksAt,
  newId,
  selectionHas,
  setKind,
  sizeAt,
  splitAt,
  textBlock,
  toggleChecked,
  toggleCode,
  toggleList,
  toggleWrap,
  withMark,
  type Block,
  type Inline,
  type Marks,
  type Sel,
  type TextBlock,
} from "./model";

const t = (text: string, marks: Marks = {}): Inline => ({ kind: "text", text, marks });
const p = (text = "", wrap: TextBlock["wrap"] = null): TextBlock => textBlock("p", text ? [t(text)] : [], wrap);
const li = (text: string, extra: Partial<NonNullable<TextBlock["list"]>> = {}): TextBlock =>
  textBlock("li", text ? [t(text)] : [], null, { list: { ordered: false, task: false, checked: false, indent: 0, start: null, ...extra } });
const range = (b1: number, o1: number, b2: number, o2: number): Sel => ({ anchor: { b: b1, o: o1 }, focus: { b: b2, o: o2 } });
const md = (blocks: Block[]) => toMarkdown(blocks);

describe("typing and Enter", () => {
  it("splits a line at the caret", () => {
    const edit = splitAt([p("hello world")], { b: 0, o: 5 });
    expect(md(edit.blocks)).toBe("hello\n world");
    expect(edit.sel.focus).toEqual({ b: 1, o: 0 });
  });

  it("carries a list on to the next line, and an empty item steps out", () => {
    let edit = splitAt([li("one")], { b: 0, o: 3 });
    expect(md(edit.blocks)).toBe("- one\n- ");
    edit = splitAt(edit.blocks, edit.sel.focus);
    expect(md(edit.blocks)).toBe("- one");
    expect(edit.blocks[1]?.kind).toBe("p");
  });

  it("steps a nested empty item out one level at a time", () => {
    const edit = splitAt([li("a"), li("", { indent: 1 })], { b: 1, o: 0 });
    expect((edit.blocks[1] as TextBlock).list?.indent).toBe(0);
  });

  it("does not carry a heading on to the next line", () => {
    const edit = splitAt([textBlock("h2", [t("Title")])], { b: 0, o: 5 });
    expect(edit.blocks.map((b) => b.kind)).toEqual(["h2", "p"]);
  });

  it("leaves a quote, callout or section from an empty last line", () => {
    for (const wrap of ["quote", "note", "details"] as const) {
      const edit = splitAt([p("x", wrap), p("", wrap)], { b: 1, o: 0 });
      expect(edit.blocks[1]?.wrap, wrap).toBeNull();
    }
  });

  it("keeps a new line inside a code block", () => {
    const code: Block = { id: 1, kind: "code", lang: "js", text: "ab", wrap: null };
    const edit = splitAt([code], { b: 0, o: 1 });
    expect(edit.blocks[0]?.kind === "code" && edit.blocks[0].text).toBe("a\nb");
  });

  it("types with the marks of the character before the caret", () => {
    const content = [t("bold", { b: true }), t(" plain")];
    expect(marksAt(content, 4)).toEqual({ b: true });
    expect(marksAt(content, 6)).toEqual({});
    const edit = insertAt([textBlock("p", content)], { b: 0, o: 4 }, [t("er", marksAt(content, 4))]);
    expect(md(edit.blocks)).toBe("**bolder** plain");
  });

  it("does not carry a link on past its end", () => {
    const content = [t("site", { link: { url: "https://a.b", noEmbed: false } })];
    expect(marksAt(content, 4)).toEqual({});
  });
});

describe("Backspace and Delete at the edges", () => {
  it("turns a list item, heading or callout line back into a plain line before joining", () => {
    let edit = joinBackward([p("a"), li("b")], 1);
    expect(edit.blocks[1]?.kind).toBe("p");
    edit = joinBackward([p("a"), textBlock("h1", [t("b")])], 1);
    expect(edit.blocks[1]?.kind).toBe("p");
    edit = joinBackward([p("a"), p("b", "note")], 1);
    expect(edit.blocks[1]?.wrap).toBeNull();
  });

  it("joins a plain line to the one above", () => {
    const edit = joinBackward([p("a"), p("b")], 1);
    expect(md(edit.blocks)).toBe("ab");
    expect(edit.sel.focus).toEqual({ b: 0, o: 1 });
  });

  it("takes a rule away rather than joining through it", () => {
    const edit = joinBackward([p("a"), { id: 9, kind: "hr", wrap: null }, p("b")], 2);
    expect(md(edit.blocks)).toBe("a\nb");
  });

  it("joins the next line with Delete", () => {
    expect(md(joinForward([p("a"), p("b")], 0).blocks)).toBe("ab");
  });
});

describe("deleting a selection", () => {
  it("joins what is left on either side", () => {
    const edit = deleteRange([p("hello"), p("middle"), p("world")], range(0, 2, 2, 3));
    expect(md(edit.blocks)).toBe("held");
  });

  it("takes a table in the middle away whole", () => {
    const edit = deleteRange([p("ab"), emptyTable(2, 2), p("cd")], range(0, 1, 2, 1));
    expect(md(edit.blocks)).toBe("ad");
  });

  it("empties the cells a selection crosses in one table", () => {
    const table = { ...emptyTable(2, 2), rows: [[[t("a")], [t("b")]], [[t("c")], [t("d")]]] };
    const edit = deleteRange([table], { anchor: { b: 0, o: 0, cell: [0, 1] }, focus: { b: 0, o: 1, cell: [1, 0] } });
    expect(edit.blocks[0]?.kind === "table" && edit.blocks[0].rows.map((r) => r.map((c) => c.length))).toEqual([[1, 0], [0, 1]]);
  });
});

describe("formatting", () => {
  it("marks a selection across lines, and takes it off again", () => {
    const blocks = [p("one"), p("two")];
    const sel = range(0, 1, 1, 2);
    const on = mapSelection(blocks, sel, (m) => withMark(m, "b", true));
    expect(md(on)).toBe("o**ne**\n**tw**o");
    expect(selectionHas(on, sel, (m) => !!m.b)).toBe(true);
    expect(md(mapSelection(on, sel, (m) => withMark(m, "b", false)))).toBe("one\ntwo");
  });

  it("clears marks and makes headings plain", () => {
    const blocks = [textBlock("h1", [t("Big", { b: true, i: true })])];
    expect(md(clearFormatting(blocks, range(0, 0, 0, 3)))).toBe("Big");
  });

  it("makes lines headings or small print", () => {
    expect(md(setKind([p("a"), p("b")], range(0, 0, 1, 1), "h3"))).toBe("### a\n### b");
    expect(md(setKind([p("a")], caret(0, 0), "subtext"))).toBe("-# a");
  });
});

describe("lists", () => {
  it("makes lines a list of each kind, and plain again", () => {
    const two = [p("a"), p("b")];
    const all = range(0, 0, 1, 1);
    expect(md(toggleList(two, all, "bullet"))).toBe("- a\n- b");
    expect(md(toggleList(two, all, "ordered"))).toBe("1. a\n2. b");
    expect(md(toggleList(two, all, "task"))).toBe("- [ ] a\n- [ ] b");
    expect(md(toggleList(toggleList(two, all, "bullet"), all, "bullet"))).toBe("a\nb");
  });

  it("indents one level past the item above at most", () => {
    const blocks = [li("a"), li("b"), li("c")];
    const once = indentBy(blocks, caret(1, 0), 1);
    expect(md(once)).toBe("- a\n  - b\n- c");
    const twice = indentBy(once, caret(1, 0), 1);
    expect(md(twice)).toBe("- a\n  - b\n- c");
    expect(md(indentBy(once, caret(1, 0), -1))).toBe("- a\n- b\n- c");
  });

  it("ticks a box", () => {
    const blocks = [li("milk", { task: true })];
    expect(md(toggleChecked(blocks, 0))).toBe("- [x] milk");
  });
});

describe("quotes, callouts and sections", () => {
  it("wraps lines in a callout, and takes them out again", () => {
    const blocks = [p("a"), p("b")];
    const all = range(0, 0, 1, 1);
    const note = toggleWrap(blocks, all, "warning");
    expect(md(note.blocks)).toBe("> [!WARNING]\n> a\n> b");
    expect(md(toggleWrap(note.blocks, all, "warning").blocks)).toBe("a\nb");
  });

  it("makes a plain quote of text lines only", () => {
    const edit = toggleWrap([textBlock("h2", [t("x")])], caret(0, 0), "quote");
    expect(md(edit.blocks)).toBe("> x");
  });

  it("makes a line a section's summary, with a line under it for what it hides", () => {
    const edit = toggleWrap([p("Logs")], caret(0, 4), "details");
    expect(md(edit.blocks)).toBe("::: details Logs\n:::");
    expect(edit.blocks.length).toBe(2);
    expect(edit.sel.focus).toEqual({ b: 1, o: 0 });
  });

  it("keeps two callouts of a kind apart when they are written", () => {
    const blocks = [p("a", "note"), p("b", "tip")];
    expect(md(blocks)).toBe("> [!NOTE]\n> a\n\n> [!TIP]\n> b");
  });
});

describe("code, tables and rules", () => {
  it("turns lines into a code block and back", () => {
    const code = toggleCode([p("a"), p("b")], range(0, 0, 1, 1));
    expect(md(code.blocks)).toBe("```\na\nb\n```");
    expect(md(toggleCode(code.blocks, caret(0, 0)).blocks)).toBe("a\nb");
  });

  it("inserts a table with a line after it, the caret in its first cell", () => {
    const edit = insertBlock([p("x")], caret(0, 1), emptyTable(2, 2));
    expect(edit.blocks.map((b) => b.kind)).toEqual(["p", "table", "p"]);
    expect(edit.sel.focus).toEqual({ b: 1, o: 0, cell: [0, 0] });
  });

  it("adds and takes away rows and columns, and keeps the header row", () => {
    let blocks: Block[] = [emptyTable(2, 2)];
    blocks = editTable(blocks, 0, { kind: "addRow", at: 2 });
    blocks = editTable(blocks, 0, { kind: "addCol", at: 1 });
    expect(blocks[0]?.kind === "table" && [blocks[0].rows.length, blocks[0].align.length]).toEqual([3, 3]);
    blocks = editTable(blocks, 0, { kind: "delRow", at: 0 });
    expect(blocks[0]?.kind === "table" && blocks[0].rows.length).toBe(3);
    blocks = editTable(blocks, 0, { kind: "align", col: 0, align: "center" });
    expect(md(blocks).split("\n")[1]).toBe("|:-:|---|---|");
  });
});

describe("a note's files", () => {
  const file = (id: string, name = "photo.png"): Block => ({ id: newId(), kind: "file", file: id, name, wrap: null });

  it("go in as a block of their own with a line after to carry on typing", () => {
    const edit = insertBlock([p("before")], caret(0, 6), file("123"));
    expect(edit.blocks.map((b) => b.kind)).toEqual(["p", "file", "p"]);
    expect(edit.sel.focus).toEqual({ b: 2, o: 0 });
    // on an empty line the file takes the line's place
    expect(insertBlock([p("")], caret(0, 0), file("123")).blocks.map((b) => b.kind)).toEqual(["file", "p"]);
  });

  it("are removed whole, by Backspace after them and Delete before them", () => {
    const blocks = [p("a"), file("123"), p("b")];
    expect(joinBackward(blocks, 2).blocks.map((b) => b.kind)).toEqual(["p", "p"]);
    expect(joinForward(blocks, 0).blocks.map((b) => b.kind)).toEqual(["p", "p"]);
    // a selection across one takes it with the words
    const cut = deleteRange(blocks, range(0, 1, 2, 0));
    expect(md(cut.blocks)).toBe("ab");
  });

  it("have nothing to type in: Enter on one starts a line under it", () => {
    const edit = splitAt([file("123")], { b: 0, o: 0 });
    expect(edit.blocks.map((b) => b.kind)).toEqual(["file", "p"]);
    expect(edit.sel.focus).toEqual({ b: 1, o: 0 });
    expect(sizeAt([file("123")], { b: 0, o: 0 })).toBe(0);
    expect(isVoid(file("1")) && !isText(file("1"))).toBe(true);
  });

  it("stay out of a quote, which holds lines of words, and go into a callout", () => {
    const blocks = [p("a"), file("123"), p("b")];
    expect(toggleWrap(blocks, range(0, 0, 2, 1), "quote").blocks.map((b) => b.wrap)).toEqual(["quote", null, "quote"]);
    expect(toggleWrap(blocks, range(0, 0, 2, 1), "note").blocks.map((b) => b.wrap)).toEqual(["note", "note", "note"]);
  });
});
