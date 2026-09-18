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

  it("counts as the top layer, so a dialog beneath it stands down", async () => {
    render(<ContextMenuHost />);
    open();
    await settle();
    const layers = document.querySelectorAll("[data-modal-layer]");
    expect(layers[layers.length - 1]).toBe(screen.getByRole("menu"));
  });
});
