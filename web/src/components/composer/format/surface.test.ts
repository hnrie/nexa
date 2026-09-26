// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FormatSurface, type SurfaceState } from "./surface";

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
    expect(surface.markdown()).toBe("start **bold**\n- item\nlast end");
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
