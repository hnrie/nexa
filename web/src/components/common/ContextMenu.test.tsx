// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { ContextMenuHost } from "./ContextMenu";

/** The focus into the menu waits a frame, because the menu is hidden until it has been placed. */
async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

const items: ContextMenuItem[] = [
  { id: "h", label: "Microphone", heading: true },
  { id: "copy", label: "Copy Link" },
  { id: "edit", label: "Edit Message", separatorAfter: true },
  { id: "pin", label: "Pin", disabled: true },
  { id: "delete", label: "Delete Message", danger: true },
];

function open() {
  act(() => useUI.getState().openContextMenu({ x: 10, y: 10, items }));
}

const label = () => (document.activeElement?.textContent ?? "").trim();

beforeEach(() => {
  useUI.setState({ contextMenu: null });
});

afterEach(() => {
  cleanup();
  useUI.setState({ contextMenu: null });
});

describe("ContextMenuHost keyboard", () => {
  it("moves focus into the menu, then with the arrows, Home and End", async () => {
    render(<ContextMenuHost />);
    open();
    await settle();
    expect(label()).toBe("Copy Link");

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Edit Message");
    // a disabled item is not a stop
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Delete Message");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Copy Link");
    fireEvent.keyDown(menu, { key: "End" });
    expect(label()).toBe("Delete Message");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(label()).toBe("Copy Link");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(label()).toBe("Delete Message");
  });

  it("jumps to an item by its first letters", async () => {
    render(<ContextMenuHost />);
    open();
    await settle();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "d" });
    expect(label()).toBe("Delete Message");
    fireEvent.keyDown(menu, { key: "e" });
    // "de" is Delete, not Edit: the run of letters is one prefix
    expect(label()).toBe("Delete Message");
  });

  it("gives a heading its own named group, and a separator a role", async () => {
    render(<ContextMenuHost />);
    open();
    await settle();
    expect(screen.getByRole("group", { name: "Microphone" })).toBeTruthy();
    expect(screen.getAllByRole("separator").length).toBe(1);
    // headings are not items
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Copy Link", "Edit Message", "Pin", "Delete Message"]);
  });

  it("closes on Escape without letting the key reach the dialog underneath", async () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    render(<ContextMenuHost />);
    open();
    await settle();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(useUI.getState().contextMenu).toBeNull();
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind);
  });

  it("gives focus back to whatever opened it", async () => {
    render(
      <>
        <button data-testid="row">A message</button>
        <ContextMenuHost />
      </>,
    );
    const row = screen.getByTestId("row");
    row.focus();
    open();
    await settle();
    expect(document.activeElement).not.toBe(row);
    await act(async () => useUI.getState().closeContextMenu());
    expect(document.activeElement).toBe(row);
  });

  it("shows a note as a line to read, never a stop for the arrows", async () => {
    render(<ContextMenuHost />);
    act(() => useUI.getState().openContextMenu({ x: 10, y: 10, label: "Sent today", items: [{ id: "a", label: "Reply" }, { id: "n", label: "Sent today", note: true }] }));
    await settle();
    const menu = screen.getByRole("menu", { name: "Sent today" });
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Reply"]);
    expect(menu.textContent).toContain("Sent today");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Reply");
  });

  it("lines a menu up with the end of the button it belongs to, however wide it turns out", async () => {
    render(<ContextMenuHost />);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 150, height: 100, top: 0, left: 0, right: 150, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    act(() => useUI.getState().openContextMenu({ x: 0, y: 0, anchor: { left: 400, right: 432, top: 20, bottom: 52, align: "end" }, items }));
    await settle();
    const menu = screen.getByRole("menu");
    // its right edge on the button's right edge, just under it
    expect(menu.style.left).toBe("282px");
    expect(menu.style.top).toBe("56px");
    rect.mockRestore();
  });

  it("counts as the top layer, so a dialog beneath it stands down", async () => {
    render(<ContextMenuHost />);
    open();
    await settle();
    const layers = document.querySelectorAll("[data-modal-layer]");
    expect(layers[layers.length - 1]).toBe(screen.getByRole("menu"));
  });
});

describe("ContextMenuHost submenus", () => {
  const picked = vi.fn();
  const nested: ContextMenuItem[] = [
    { id: "read", label: "Mark as read" },
    {
      id: "folder",
      label: "Add to folder",
      submenu: [
        { id: "games", label: "Games", onSelect: () => picked("games") },
        { id: "study", label: "Study", onSelect: () => picked("study"), separatorAfter: true },
        { id: "new", label: "New folder", onSelect: () => picked("new") },
      ],
    },
    { id: "leave", label: "Leave server", danger: true },
  ];

  function openNested() {
    act(() => useUI.getState().openContextMenu({ x: 10, y: 10, label: "Nexa Design Lab", items: nested }));
  }

  /** Real time passing, for the delays that stand between a resting pointer and a submenu. */
  async function wait(ms: number) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  afterEach(() => {
    picked.mockReset();
    document.documentElement.dir = "ltr";
    vi.unstubAllGlobals();
  });

  it("opens beside the menu with the arrow towards it and Enter, and goes back with the other arrow", async () => {
    render(<ContextMenuHost />);
    openNested();
    await settle();
    const menu = screen.getByRole("menu", { name: "Nexa Design Lab" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Add to folder");
    const parent = document.activeElement as HTMLElement;
    expect(parent.getAttribute("aria-haspopup")).toBe("menu");
    expect(parent.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(menu, { key: "ArrowRight" });
    await settle();
    const sub = screen.getByRole("menu", { name: "Add to folder" });
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    expect(parent.getAttribute("aria-controls")).toBe(sub.id);
    expect(label()).toBe("Games");
    fireEvent.keyDown(sub, { key: "ArrowDown" });
    expect(label()).toBe("Study");
    fireEvent.keyDown(sub, { key: "ArrowLeft" });
    await settle();
    expect(screen.queryByRole("menu", { name: "Add to folder" })).toBeNull();
    expect(label()).toBe("Add to folder");

    fireEvent.keyDown(menu, { key: "Enter" });
    await settle();
    expect(label()).toBe("Games");
  });

  it("takes Escape one level at a time", async () => {
    render(<ContextMenuHost />);
    openNested();
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to folder" }));
    await settle();
    expect(screen.getByRole("menu", { name: "Add to folder" })).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(screen.queryByRole("menu", { name: "Add to folder" })).toBeNull();
    expect(useUI.getState().contextMenu).not.toBeNull();
    expect(label()).toBe("Add to folder");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("mirrors the arrows in a right-to-left language", async () => {
    document.documentElement.dir = "rtl";
    render(<ContextMenuHost />);
    openNested();
    await settle();
    const menu = screen.getByRole("menu", { name: "Nexa Design Lab" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(label()).toBe("Add to folder");
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    await settle();
    const sub = screen.getByRole("menu", { name: "Add to folder" });
    expect(label()).toBe("Games");
    // the arrow towards the submenu does nothing more inside it
    fireEvent.keyDown(sub, { key: "ArrowLeft" });
    expect(label()).toBe("Games");
    fireEvent.keyDown(sub, { key: "ArrowRight" });
    await settle();
    expect(screen.queryByRole("menu", { name: "Add to folder" })).toBeNull();
    expect(label()).toBe("Add to folder");
  });

  it("opens when the pointer rests on its item, and waits a moment before going when it moves on", async () => {
    render(<ContextMenuHost />);
    openNested();
    await settle();
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Add to folder" }));
    // not at once: a pointer passing over on its way down opens nothing
    expect(screen.queryByRole("menu", { name: "Add to folder" })).toBeNull();
    await wait(200);
    const sub = screen.getByRole("menu", { name: "Add to folder" });
    // resting the pointer opens it without taking focus out of the menu
    expect(sub.contains(document.activeElement)).toBe(false);

    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Leave server" }));
    await wait(60);
    expect(screen.getByRole("menu", { name: "Add to folder" })).toBeTruthy();
    // reaching the submenu in time keeps it open
    fireEvent.pointerEnter(sub);
    await wait(400);
    expect(screen.getByRole("menu", { name: "Add to folder" })).toBeTruthy();

    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Leave server" }));
    await wait(400);
    expect(screen.queryByRole("menu", { name: "Add to folder" })).toBeNull();
  });

  it("runs what is chosen in a submenu and closes the whole menu", async () => {
    render(<ContextMenuHost />);
    openNested();
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to folder" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Study" }));
    expect(picked).toHaveBeenCalledWith("study");
    expect(useUI.getState().contextMenu).toBeNull();
  });

  it("drills in on a touch screen, with the way back at the top", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("hover: none"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<ContextMenuHost />);
    openNested();
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to folder" }));
    await settle();
    // the same menu, now showing the submenu, named after it and headed by it
    const menu = screen.getByRole("menu", { name: "Add to folder" });
    expect(screen.getAllByRole("menu").length).toBe(1);
    expect(screen.getByRole("group", { name: "Add to folder" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Back", "Games", "Study", "New folder"]);
    // focus on the first choice, the way back one step up
    expect(label()).toBe("Games");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(label()).toBe("Back");

    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    await settle();
    expect(screen.getByRole("menu", { name: "Nexa Design Lab" })).toBeTruthy();
    expect(label()).toBe("Add to folder");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to folder" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    expect(picked).toHaveBeenCalledWith("new");
    expect(useUI.getState().contextMenu).toBeNull();
  });
});
