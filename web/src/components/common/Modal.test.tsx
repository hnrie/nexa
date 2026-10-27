// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(cleanup);

/** Tab as the browser would: the trap is a keydown handler, so this is what it sees. */
function tab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document, { key: "Tab", shiftKey: shift });
}

describe("Modal", () => {
  it("opens and restores focus without scrolling an embedding homepage", () => {
    render(<button data-testid="preview-opener">Preview action</button>);
    const opener = screen.getByTestId("preview-opener");
    opener.focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { unmount } = render(<Modal open onClose={() => {}} title="Create an Account to Continue"><p>Keep exploring</p></Modal>);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    unmount();
    expect(document.activeElement).toBe(opener);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("keeps Tab inside the dialog, forwards and backwards", () => {
    render(
      <>
        <button data-testid="outside">Behind the scrim</button>
        <Modal open onClose={() => {}} title="Create Your Server" footer={<button>Create</button>}>
          <input aria-label="Name" />
          <button>Upload</button>
        </Modal>
      </>,
    );
    const inside = () => !!document.activeElement?.closest("[data-modal-layer]");
    // a dialog that asks for something starts in its first field
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    // jsdom does not move focus for a Tab of its own, so the walk is the
    // handler's: it only ever preventDefaults and re-aims at the edges, which
    // is exactly the behaviour under test.
    const stops = [screen.getByLabelText("Name"), screen.getByText("Upload"), screen.getByText("Create")];
    for (let i = 0; i < 12; i++) {
      stops[i % stops.length]!.focus();
      tab();
      expect(inside()).toBe(true);
      stops[i % stops.length]!.focus();
      tab(true);
      expect(inside()).toBe(true);
    }
    expect(screen.getByTestId("outside")).not.toBe(document.activeElement);
  });

  it("wraps from the last stop to the first and back", () => {
    render(
      <Modal open onClose={() => {}} bare ariaLabel="Two stops">
        <button>First</button>
        <button>Last</button>
      </Modal>,
    );
    const first = screen.getByText("First");
    const last = screen.getByText("Last");
    // `bare`, so the header's close button is not a third stop
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
  });

  it("is announced by its own heading, and a bare one by the name it was given", () => {
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Delete Channel">
        <p>Sure?</p>
      </Modal>,
    );
    const card = screen.getByRole("dialog");
    const id = card.getAttribute("aria-labelledby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe("Delete Channel");
    unmount();

    render(
      <Modal open onClose={() => {}} bare ariaLabel="Quick switcher">
        <input aria-label="Search" />
      </Modal>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Quick switcher");
  });

  it("gives focus back to whatever opened it", () => {
    render(<button data-testid="opener">Open</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    const { unmount } = render(
      <Modal open onClose={() => {}} title="Anything">
        <button>Inside</button>
      </Modal>,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("starts in the field to type into, not a radio or a hidden file input before it", () => {
    render(
      <Modal open onClose={() => {}} title="Create Channel">
        <input type="radio" aria-label="Text" defaultChecked />
        <input type="file" hidden aria-label="Icon" />
        <input aria-label="Channel name" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Channel name"));
  });

  it("gives Escape to the topmost dialog only", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal open onClose={outer} title="Settings">
          <button>Something</button>
        </Modal>
        <Modal open onClose={inner} title="Confirm">
          <button>Delete</button>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("does its main action on Enter in a text box, and nowhere else", () => {
    const submit = vi.fn();
    render(
      <Modal open onClose={() => {}} title="Change your display name" onSubmit={submit}>
        <input aria-label="Display name" />
        <textarea aria-label="About me" />
        <input type="checkbox" aria-label="Remember" />
      </Modal>,
    );
    fireEvent.keyDown(screen.getByLabelText("Display name"), { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    // a new line, a word being composed, and Enter on a checkbox are not a submit
    fireEvent.keyDown(screen.getByLabelText("About me"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Display name"), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(screen.getByLabelText("Display name"), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(screen.getByLabelText("Remember"), { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
