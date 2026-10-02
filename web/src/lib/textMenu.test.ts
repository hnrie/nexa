// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "@/stores/ui";
import { useUI } from "@/stores/ui";

const spell = vi.hoisted(() => ({ active: false, learn: vi.fn() }));
vi.mock("@/lib/spell", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/spell")>();
  return {
    ...real,
    spellActive: () => spell.active,
    misspelled: async (words: string[]) => new Set(words.filter((w) => w === "wrold")),
    suggestions: async (word: string) => (word === "wrold" ? ["world", "wold"] : []),
    learn: spell.learn,
  };
});

import { installTextMenu, setTextMenu } from "./textMenu";

let uninstall: () => void = () => {};

beforeEach(() => {
  spell.active = false;
  spell.learn.mockReset();
  useUI.setState({ contextMenu: null, toasts: [] });
  document.body.innerHTML = "";
  uninstall = installTextMenu(document);
});

afterEach(() => {
  uninstall();
  delete (window as { evilionDesktop?: unknown }).evilionDesktop;
});

function rightClick(el: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10, ...init });
  el.dispatchEvent(e);
  return e;
}

async function opened(): Promise<ContextMenuItem[]> {
  await vi.waitFor(() => expect(useUI.getState().contextMenu).not.toBeNull());
  return useUI.getState().contextMenu!.items;
}

function box(value: string, attrs: Record<string, string> = {}): HTMLTextAreaElement {
  const ta = document.createElement("textarea");
  ta.value = value;
  for (const [k, v] of Object.entries(attrs)) ta.setAttribute(k, v);
  document.body.append(ta);
  return ta;
}

const ids = (items: ContextMenuItem[]) => items.map((i) => i.id);

describe("the text box menu", () => {
  it("opens on a textarea in place of the browser's, with the editing items", async () => {
    const ta = box("hello there");
    ta.setSelectionRange(0, 5);
    expect(rightClick(ta).defaultPrevented).toBe(true);
    const items = await opened();
    expect(ids(items)).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
    expect(items.find((i) => i.id === "copy")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "copy")?.keys).toMatch(/C$/);
  });

  it("offers nothing to cut or copy with nothing selected, and nothing to select in an empty box", async () => {
    box("");
    rightClick(document.querySelector("textarea")!);
    const items = await opened();
    expect(items.find((i) => i.id === "cut")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "copy")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "selectAll")?.disabled).toBe(true);
  });

  it("gives a box that takes markdown a Format submenu, and Bold wraps the selection", async () => {
    const ta = box("say hello", { "data-markdown": "" });
    ta.setSelectionRange(4, 9);
    rightClick(ta);
    const items = await opened();
    const format = items.find((i) => i.id === "format");
    expect(format?.submenu?.map((i) => i.id)).toEqual(["format:bold", "format:italic", "format:underline", "format:strike", "format:spoiler", "format:code"]);
    format!.submenu!.find((i) => i.id === "format:bold")!.onSelect!();
    expect(ta.value).toBe("say **hello**");
  });

  it("puts a box's own items last, and its own formatting in the submenu", async () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    div.innerHTML = "<p>some <span>words</span></p>";
    document.body.append(div);
    const format = vi.fn();
    setTextMenu(div, { format, extra: () => [{ id: "mine", label: "Mine" }] });
    rightClick(div.querySelector("span")!);
    const items = await opened();
    expect(items[items.length - 1]?.id).toBe("mine");
    items.find((i) => i.id === "format")!.submenu!.find((i) => i.id === "format:spoiler")!.onSelect!();
    expect(format).toHaveBeenCalledWith("spoiler");
  });

  it("selects the whole box from Select All", async () => {
    const ta = box("every word");
    ta.setSelectionRange(2, 2);
    rightClick(ta);
    (await opened()).find((i) => i.id === "selectAll")!.onSelect!();
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([0, 10]);
  });

  it("offers only Copy and Select All in a box that cannot be changed", async () => {
    const ta = box("read me", { readonly: "" });
    rightClick(ta);
    expect(ids(await opened())).toEqual(["copy", "selectAll"]);
  });

  it("leaves password, email and number boxes to the browser", () => {
    for (const type of ["password", "email", "number"]) {
      const input = document.createElement("input");
      input.type = type;
      document.body.append(input);
      expect(rightClick(input).defaultPrevented).toBe(false);
    }
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("opens the browser's own menu for Shift with the right click", () => {
    expect(rightClick(box("x"), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("leaves a right click another menu has already taken", () => {
    const ta = box("x");
    ta.parentElement!.addEventListener("contextmenu", (e) => e.preventDefault(), { once: true });
    rightClick(ta);
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("offers spellings for a misspelled word, and a spelling replaces it", async () => {
    spell.active = true;
    const ta = box("hello wrold", { "data-spell": "" });
    // the right click put the caret in the word
    ta.setSelectionRange(8, 8);
    rightClick(ta);
    const items = await opened();
    expect(ids(items).slice(0, 3)).toEqual(["spell:world", "spell:wold", "spell:add"]);
    items[0]!.onSelect!();
    expect(ta.value).toBe("hello world");
  });

  it("adds a misspelled word to the dictionary", async () => {
    spell.active = true;
    const ta = box("hello wrold", { "data-spell": "" });
    ta.setSelectionRange(7, 7);
    rightClick(ta);
    (await opened()).find((i) => i.id === "spell:add")!.onSelect!();
    expect(spell.learn).toHaveBeenCalledWith("wrold");
  });

  it("says nothing about spelling for a word spelled right, or in a box that is not checked", async () => {
    spell.active = true;
    const checked = box("hello wrold", { "data-spell": "" });
    checked.setSelectionRange(2, 2);
    rightClick(checked);
    expect(ids(await opened())[0]).toBe("undo");
    useUI.setState({ contextMenu: null });
    const unchecked = box("hello wrold", { spellcheck: "false" });
    unchecked.setSelectionRange(8, 8);
    rightClick(unchecked);
    expect(ids(await opened())[0]).toBe("undo");
  });

  it("gives an older desktop app the same menu, whose Paste offers the update it needs", async () => {
    (window as { evilionDesktop?: unknown }).evilionDesktop = { version: "1.0.5" };
    const ta = box("hello");
    expect(rightClick(ta).defaultPrevented).toBe(true);
    const items = await opened();
    expect(ids(items)).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
    const paste = items.find((i) => i.id === "paste")!;
    expect(paste.warn).toBeTruthy();
    expect(paste.keys).toBeUndefined();
    paste.onSelect!();
    expect(useUI.getState().modals.at(-1)?.kind).toBe("pasteUpdate");
  });

  it("gives words picked out on the page, and links, a menu of the app's own", async () => {
    document.body.innerHTML = `<p id="p">some words <a id="a" href="https://example.com/x">a link</a></p>`;
    const words = document.getElementById("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(words, 0);
    range.setEnd(words, 4);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    expect(rightClick(document.getElementById("p")!).defaultPrevented).toBe(true);
    expect(ids(await opened())).toEqual(["copy"]);
    useUI.setState({ contextMenu: null });
    getSelection()!.removeAllRanges();
    rightClick(document.getElementById("a")!);
    expect(ids(await opened())).toEqual(["open-link", "copy-link"]);
    useUI.setState({ contextMenu: null });
    // anywhere else, the browser's own
    expect(rightClick(document.body).defaultPrevented).toBe(false);
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("pastes through the desktop app that can", async () => {
    const paste = vi.fn(async () => true);
    (window as { evilionDesktop?: unknown }).evilionDesktop = { version: "1.0.6", paste };
    const ta = box("hello");
    ta.setSelectionRange(5, 5);
    expect(rightClick(ta).defaultPrevented).toBe(true);
    (await opened()).find((i) => i.id === "paste")!.onSelect!();
    await vi.waitFor(() => expect(paste).toHaveBeenCalledOnce());
    // the box has the focus back, so the app's paste lands in it
    expect(document.activeElement).toBe(ta);
    expect(useUI.getState().toasts).toEqual([]);
  });

  it("leaves focus in the box when opened with the mouse, and takes it when opened from the keyboard", async () => {
    const ta = box("hello there");
    ta.setSelectionRange(0, 5);
    rightClick(ta);
    await opened();
    expect(useUI.getState().contextMenu?.keepFocus).toBe(true);
    useUI.setState({ contextMenu: null });
    // the menu key and Shift+F10 send no mouse button
    rightClick(ta, { button: 0 });
    await opened();
    expect(useUI.getState().contextMenu?.keepFocus).toBe(false);
  });
});

