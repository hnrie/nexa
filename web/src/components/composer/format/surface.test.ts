// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FormatSurface, type FileHost, type SurfaceState } from "./surface";

let root: HTMLDivElement;
let surface: FormatSurface;
let changes = 0;
let last: SurfaceState | null = null;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  changes = 0;
  surface = new FormatSurface(root, {
    labels: { placeholder: "Message @Bob", summary: "Summary", code: "Code", alert: (k) => k.toUpperCase() },
    onChange: () => (changes += 1),
    onState: (s) => (last = s),
  });
});

afterEach(() => {
  surface.destroy();
  root.remove();
});

/** Puts the page's selection in a block's first text, from one offset to another. */
function select(block: number, from: number, to = from): void {
  const el = root.children[block] as HTMLElement;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const at = (o: number): [Node, number] => {
    let left = o;
    for (const n of nodes) {
      if (left <= n.length) return [n, left];
      left -= n.length;
    }
    return [el, el.childNodes.length];
  };
  const [a, ao] = at(from);
  const [b, bo] = at(to);
  document.getSelection()!.setBaseAndExtent(a, ao, b, bo);
}

function input(type: string, data?: string): InputEvent {
  const e = new InputEvent("beforeinput", { inputType: type, data: data ?? null, bubbles: true, cancelable: true });
  root.dispatchEvent(e);
  return e;
}

describe("the writing surface", () => {
  it("draws a message's markdown as blocks, and writes it back unchanged", () => {
    const md = "## Title\n**bold** and [red]{red}\n- one\n  - two\n- [x] done\n> [!NOTE]\n> careful\n```js\nx\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n---";
    surface.load(md);
    const kinds = [...root.children].map((c) => (c as HTMLElement).dataset["b"]);
    expect(kinds).toEqual(["h2", "p", "li", "li", "li", "p", "code", "table", "hr"]);
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("[data-m='color']")?.getAttribute("data-fg")).toBe("red");
    expect(root.querySelector("[data-task='done']")).not.toBeNull();
    expect(root.querySelector("[data-wrap='note'][data-title]")?.getAttribute("data-title")).toBe("NOTE");
    expect(root.querySelector("pre")?.getAttribute("data-lang")).toBe("js");
    expect(root.querySelectorAll("[data-cell]").length).toBe(4);
    expect(surface.markdown()).toBe(md);
  });

  it("shows the placeholder on an empty message", () => {
    surface.load("");
    expect((root.firstElementChild as HTMLElement).dataset["placeholder"]).toBe("Message @Bob");
  });

  it("reads typing back from the page", () => {
    surface.load("hello");
    const text = root.querySelector("[data-b='p']")!.firstChild as Text;
    text.data = "hello there";
    root.dispatchEvent(new Event("input", { bubbles: true }));
    expect(surface.markdown()).toBe("hello there");
    expect(changes).toBeGreaterThan(0);
  });

  it("makes a selection bold, and takes it off again", () => {
    surface.load("hello world");
    select(0, 6, 11);
    surface.command({ t: "mark", flag: "b" });
    expect(surface.markdown()).toBe("hello **world**");
    expect(root.querySelector("strong")?.textContent).toBe("world");
    select(0, 6, 11);
    surface.command({ t: "mark", flag: "b" });
    expect(surface.markdown()).toBe("hello world");
  });

  it("splits a line on Enter and joins it again on Backspace", () => {
    surface.load("helloworld");
    select(0, 5);
    expect(input("insertParagraph").defaultPrevented).toBe(true);
    expect(surface.markdown()).toBe("hello\nworld");
    select(1, 0);
    input("deleteContentBackward");
    expect(surface.markdown()).toBe("helloworld");
  });

  it("turns typed markdown at the start of a line into the block it names", () => {
    surface.load("-");
    select(0, 1);
    expect(input("insertText", " ").defaultPrevented).toBe(true);
    expect(root.querySelector("[data-list='bullet']")).not.toBeNull();
  });

  it("undoes and redoes a change", () => {
    surface.load("abc");
    select(0, 0, 3);
    surface.command({ t: "mark", flag: "i" });
    expect(surface.markdown()).toBe("*abc*");
    surface.command({ t: "undo" });
    expect(surface.markdown()).toBe("abc");
    surface.command({ t: "redo" });
    expect(surface.markdown()).toBe("*abc*");
  });

  it("reads pasted markdown as formatting", () => {
    surface.load("start end");
    select(0, 6);
    // jsdom has no DataTransfer: a clipboard that holds just the text
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "**bold**\n- item\nlast " : "") } });
    root.dispatchEvent(paste);
    // the space the pasted text ends with is kept, as it was copied
    expect(surface.markdown()).toBe("start **bold**\n- item\nlast  end");
  });

  it("gives a link to the selected words, with https:// kept as given", () => {
    surface.load("see the site");
    select(0, 8, 12);
    surface.command({ t: "link", url: "https://chat.evilion.xyz" });
    expect(surface.markdown()).toBe("see the [site](https://chat.evilion.xyz)");
  });

  it("colours and highlights the selected words", () => {
    surface.load("one two");
    select(0, 0, 3);
    surface.command({ t: "color", part: "fg", value: "blue" });
    select(0, 4, 7);
    surface.command({ t: "color", part: "bg", value: "yellow" });
    expect(surface.markdown()).toBe("[one]{blue} [two]{on yellow}");
  });

  it("inserts a table and edits it", () => {
    surface.load("x");
    select(0, 1);
    surface.command({ t: "table", rows: 2, cols: 2 });
    expect(root.querySelectorAll("th").length).toBe(2);
    surface.command({ t: "tableOp", op: { kind: "addCol", at: 2 } });
    expect(root.querySelectorAll("th").length).toBe(3);
  });

  it("tells the toolbar what the caret is in", async () => {
    surface.load("- [ ] milk");
    select(0, 2);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 30));
    expect(last?.kind).toBe("li");
    expect(last?.list?.task).toBe(true);
  });
});

describe("a note on the writing surface", () => {
  let files: FileHost[] = [];
  let pasted: File[] = [];
  let note: FormatSurface;
  let page: HTMLDivElement;

  beforeEach(() => {
    files = [];
    pasted = [];
    page = document.createElement("div");
    document.body.appendChild(page);
    note = new FormatSurface(page, {
      labels: { placeholder: "Start writing", summary: "Summary", code: "Code", alert: (k) => k.toUpperCase() },
      onChange: () => undefined,
      onState: () => undefined,
      read: { files: true, max: 200_000 },
      onFiles: (shown) => (files = shown),
      onPasteFiles: (f) => (pasted = f),
    });
  });
  afterEach(() => {
    note.destroy();
    page.remove();
  });

  /** Puts the page's caret in a block of the note's surface. */
  const caretIn = (block: number, offset: number): void => {
    const el = page.children[block] as HTMLElement;
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
    document.getSelection()!.setBaseAndExtent(text ?? el, text ? offset : 0, text ?? el, text ? offset : 0);
    document.dispatchEvent(new Event("selectionchange"));
  };

  it("shows a file as a block of its own, with a frame for the editor to draw it in", () => {
    note.load("Before\n![photo.png](nexa-file:123)\nAfter");
    expect([...page.children].map((c) => (c as HTMLElement).dataset["b"])).toEqual(["p", "file", "p"]);
    const frame = page.children[1] as HTMLElement;
    expect(frame.contentEditable).toBe("false");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ file: "123", name: "photo.png" });
    expect(files[0]?.el).toBe(frame.firstElementChild);
    expect(note.markdown()).toBe("Before\n![photo.png](nexa-file:123)\nAfter");
  });

  it("puts a file where the caret is, and takes it out again with Backspace", () => {
    note.load("one\ntwo");
    caretIn(0, 3);
    note.command({ t: "file", file: "77", name: "plan.pdf" });
    expect(note.markdown()).toBe("one\n![plan.pdf](nexa-file:77)\ntwo");
    expect(files.map((f) => f.file)).toEqual(["77"]);
    caretIn(2, 0);
    const e = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    page.dispatchEvent(e);
    expect(note.markdown()).toBe("one\ntwo");
    expect(files).toHaveLength(0);
  });

  it("takes a file out by its key, from the button the editor draws on it", () => {
    note.load("one\n![a.png](nexa-file:a)\n![b.png](nexa-file:b)\ntwo");
    const key = files.find((f) => f.file === "a")!.key;
    note.command({ t: "removeBlock", key });
    expect(note.markdown()).toBe("one\n![b.png](nexa-file:b)\ntwo");
    expect(files.map((f) => f.file)).toEqual(["b"]);
    // undone like any other change
    note.command({ t: "undo" });
    expect(note.markdown()).toBe("one\n![a.png](nexa-file:a)\n![b.png](nexa-file:b)\ntwo");
    // a key no block has changes nothing
    note.command({ t: "removeBlock", key: -42 });
    expect(note.markdown()).toBe("one\n![a.png](nexa-file:a)\n![b.png](nexa-file:b)\ntwo");
  });

  it("leaves keys pressed on what the editor draws in a file frame to it", () => {
    note.load("one\n![a.png](nexa-file:a)\ntwo");
    const button = document.createElement("button");
    files[0]!.el.appendChild(button);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button.dispatchEvent(enter);
    // not split or joined, and the button gets its own Enter
    expect(enter.defaultPrevented).toBe(false);
    expect(note.markdown()).toBe("one\n![a.png](nexa-file:a)\ntwo");
  });

  it("hands pasted files to the editor instead of pasting their names", () => {
    note.load("x");
    const file = new File(["png"], "shot.png", { type: "image/png" });
    const e = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, "clipboardData", { value: { files: [file], getData: () => "shot.png" } });
    page.dispatchEvent(e);
    expect(pasted).toEqual([file]);
    expect(note.markdown()).toBe("x");
  });

  it("takes in someone else's change without redrawing what stayed the same", () => {
    note.load("first\nsecond\nthird");
    const [first, , third] = [...page.children];
    expect(note.reload("first\nsecond, edited by them\nthird\nfourth, added by them")).toBe(true);
    // the lines nobody touched are the very same elements, not copies
    expect(page.children[0]).toBe(first);
    expect(page.children[2]).toBe(third);
    expect(page.children).toHaveLength(4);
    expect(note.markdown()).toBe("first\nsecond, edited by them\nthird\nfourth, added by them");
  });

  it("keeps the caret on the words it was on when lines are added above it", () => {
    note.load("alpha\nbeta\ngamma");
    caretIn(2, 3);
    note.reload("new line from them\nalpha\nbeta\ngamma");
    expect(note.sel.focus).toEqual({ b: 3, o: 3 });
    // and when the lines above it go
    note.reload("gamma");
    expect(note.sel.focus).toEqual({ b: 0, o: 3 });
  });

  it("moves the caret with its words when someone edits the same line", () => {
    note.load("the quick brown fox");
    caretIn(0, 15);
    // they change a word before the caret: it stays in front of "fox"
    note.reload("the very quick brown fox");
    expect(note.sel.focus).toEqual({ b: 0, o: 20 });
    // they add words after the caret: it does not move
    note.reload("the very quick brown fox jumps");
    expect(note.sel.focus).toEqual({ b: 0, o: 20 });
  });

  it("puts the caret somewhere sensible when the line it was on is gone", () => {
    note.load("keep\nremove me\nkeep too");
    caretIn(1, 4);
    note.reload("keep\nkeep too");
    expect(note.sel.focus.b).toBeLessThan(2);
    expect(() => note.focus()).not.toThrow();
  });

  it("marks where the caret is so that another copy of the note finds the same place", () => {
    note.load("alpha\nbeta\ngamma");
    caretIn(1, 2);
    const mark = note.cursor();
    expect(mark.a).toEqual(mark.f);
    expect(mark.f).toMatchObject({ b: 1, o: 2 });
    expect(mark.f.k).toMatch(/^[0-9a-z]+$/);
    // someone added two lines above: the mark still lands in "beta"
    note.reload("new one\nnew two\nalpha\nbeta\ngamma");
    expect(note.locate(mark.f)).toEqual({ b: 3, o: 2 });
    // the line itself was changed (it is the one being written in): the line in its place
    note.reload("new one\nnew two\nalpha\nbetamax\ngamma");
    expect(note.locate({ ...mark.f, b: 3 })).toEqual({ b: 3, o: 2 });
    // nonsense from the wire finds nothing, and a place past the end is the end
    expect(note.locate({ b: -1, o: 0, k: "x" })).toBeNull();
    expect(note.locate({ b: 1.5, o: 0, k: "x" })).toBeNull();
    expect(note.locate({ b: 99, o: 99, k: "x" })).toEqual({ b: 4, o: 5 });
  });

  it("works out where to draw someone else's caret and selection", () => {
    note.load("alpha\nbeta");
    const rect = (left: number) => ({ left, top: 10, width: 0, height: 20, right: left, bottom: 30, x: left, y: 10, toJSON: () => ({}) }) as DOMRect;
    const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[]; getBoundingClientRect?: () => DOMRect };
    const was = { rects: proto.getClientRects, box: proto.getBoundingClientRect };
    proto.getClientRects = function (this: Range) {
      return this.collapsed ? [rect(40)] : [{ ...rect(5), width: 30 } as DOMRect, { ...rect(5), top: 32, width: 12 } as DOMRect];
    };
    proto.getBoundingClientRect = () => rect(40);
    try {
      const at = (b: number, o: number) => ({ b, o, k: note.cursor().f.k });
      caretIn(0, 1);
      const k0 = note.cursor().f.k;
      const caret = note.cursorRects({ a: { b: 0, o: 2, k: k0 }, f: { b: 0, o: 2, k: k0 } });
      expect(caret.caret).toEqual({ left: 40, top: 10, height: 20 });
      expect(caret.boxes).toEqual([]);
      const picked = note.cursorRects({ a: { b: 0, o: 1, k: k0 }, f: at(1, 2) });
      expect(picked.boxes).toHaveLength(2);
      expect(picked.boxes[0]).toMatchObject({ left: 5, width: 30 });
    } finally {
      proto.getClientRects = was.rects;
      proto.getBoundingClientRect = was.box;
    }
  });

  it("does not swap the text under a word that is being composed", () => {
    note.load("hello");
    page.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(note.busy).toBe(true);
    expect(note.reload("hello from them")).toBe(false);
    expect(note.markdown()).toBe("hello");
    page.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(note.reload("hello from them")).toBe(true);
    expect(note.markdown()).toBe("hello from them");
  });
});
