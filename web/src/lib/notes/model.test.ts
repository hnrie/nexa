import { describe, expect, it } from "vitest";
import type { AttachmentMeta } from "@/crypto/message";
import { NOTE_MAX_CHARS, NOTE_PREVIEW_CHARS, NOTE_TITLE_MAX, blobIds, fileIds, headOf, pruned, readBody, readHead, sameDoc, withoutFiles, type NoteDoc } from "./model";

const file = (blob: string, over: Partial<AttachmentMeta> = {}): AttachmentMeta => ({ blob_id: blob, name: "a.png", type: "image/png", size: 10, key: "a2V5", ...over });

describe("reading a note someone else may have written", () => {
  it("takes only what a head can hold", () => {
    expect(readHead(null)).toEqual({ title: "", preview: "", files: {} });
    expect(readHead("a string")).toEqual({ title: "", preview: "", files: {} });
    expect(readHead([1, 2])).toEqual({ title: "", preview: "", files: {} });
    const head = readHead({ title: "  Shopping\n list  ", preview: "milk\n", files: { a: file("12") }, more: "ignored" });
    expect(head.title).toBe("Shopping list");
    expect(head.preview).toBe("milk\n");
    expect(Object.keys(head.files)).toEqual(["a"]);
    expect(head).not.toHaveProperty("more");
  });

  it("cuts a title and a text that are longer than a note's can be", () => {
    expect(readHead({ title: "x".repeat(NOTE_TITLE_MAX + 50) }).title).toHaveLength(NOTE_TITLE_MAX);
    expect(readBody({ md: "y".repeat(NOTE_MAX_CHARS + 10) }).md).toHaveLength(NOTE_MAX_CHARS);
    // an emoji at the cut is left out whole rather than cut in half
    const title = "x".repeat(NOTE_TITLE_MAX - 1) + "😀😀";
    expect(readHead({ title }).title.endsWith("😀")).toBe(true);
    expect(Array.from(readHead({ title }).title)).toHaveLength(NOTE_TITLE_MAX);
  });

  it("drops files that are not sealed files", () => {
    const body = readBody({
      md: "",
      files: {
        ok: file("123"),
        "bad id!": file("124"),
        nokey: file("125", { key: "" }),
        plain: { ...file("126"), plain: true, key: "" },
        blob: file("not-a-number"),
        junk: "nope",
      },
    });
    expect(Object.keys(body.files)).toEqual(["ok"]);
  });

  it("reads anything that is not a note as an empty one", () => {
    expect(readBody(undefined)).toEqual({ md: "", files: {} });
    expect(readBody({ md: 5, files: [] })).toEqual({ md: "", files: {} });
  });
});

describe("the files a note's text shows", () => {
  const md = ["Intro", "![cat.png](nexa-file:a)", "> ![in a callout](nexa-file:b)", "```", "![code.png](nexa-file:c)", "```", "text ![inline](nexa-file:d) is not a file line", "![cat.png](nexa-file:a)", "![last one](nexa-file:e)  "].join("\n");

  it("lists each once, in order, and not the ones inside code", () => {
    expect(fileIds(md)).toEqual(["a", "b", "e"]);
  });

  it("keeps only the files the text still shows", () => {
    const doc = { md, files: { a: file("1"), b: file("2"), c: file("3"), gone: file("9") } };
    expect(Object.keys(pruned(doc).files)).toEqual(["a", "b"]);
  });

  it("names every blob they need, a picture's small copy included", () => {
    const doc = { md, files: { a: file("1", { preview: { blob_id: "11", key: "a2V5", size: 4, type: "image/webp", w: 4, h: 4 } }), b: file("2"), c: file("3") } };
    expect(blobIds(doc)).toEqual(["1", "11", "2"]);
  });

  it("takes file lines out by id, wherever they are, and leaves code alone", () => {
    const out = withoutFiles(md, new Set(["a", "c"]));
    expect(out.split("\n")).toEqual(["Intro", "> ![in a callout](nexa-file:b)", "```", "![code.png](nexa-file:c)", "```", "text ![inline](nexa-file:d) is not a file line", "![last one](nexa-file:e)  "]);
    expect(withoutFiles(md, new Set())).toBe(md);
  });
});

describe("what the list shows of a note", () => {
  it("is its title and first lines, with the files those lines show", () => {
    const doc: NoteDoc = { title: "  Trip  ", md: "Day one\n![map.png](nexa-file:m)\n", files: { m: file("5"), other: file("6") } };
    const head = headOf(doc);
    expect(head.title).toBe("Trip");
    expect(head.preview).toBe(doc.md);
    expect(Object.keys(head.files)).toEqual(["m"]);
  });

  it("cuts a long note at the end of a line", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line number ${i}`);
    const head = headOf({ title: "", md: lines.join("\n"), files: {} });
    expect(head.preview.length).toBeLessThanOrEqual(NOTE_PREVIEW_CHARS);
    expect(lines.join("\n").startsWith(head.preview)).toBe(true);
    expect(head.preview.endsWith(lines[head.preview.split("\n").length - 1]!)).toBe(true);
  });

  it("only carries the files inside the part it shows", () => {
    const md = "x".repeat(NOTE_PREVIEW_CHARS + 100) + "\n![late.png](nexa-file:late)\n";
    expect(headOf({ title: "", md, files: { late: file("7") } }).files).toEqual({});
  });
});

describe("whether two states of a note are the same", () => {
  const a: NoteDoc = { title: "T", md: "one\n![p](nexa-file:x)\n", files: { x: file("1") } };
  it("goes by title, text and the files the text shows", () => {
    expect(sameDoc(a, { ...a, files: { x: file("1"), unused: file("2") } })).toBe(true);
    expect(sameDoc(a, { ...a, title: "U" })).toBe(false);
    expect(sameDoc(a, { ...a, md: "two\n" })).toBe(false);
    expect(sameDoc(a, { ...a, files: { x: file("3") } })).toBe(false);
  });
});
