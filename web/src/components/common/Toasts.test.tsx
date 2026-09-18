// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useUI } from "@/stores/ui";
import { Toasts } from "./Toasts";

afterEach(() => {
  cleanup();
  useUI.setState({ toasts: [] });
});

describe("Toasts", () => {
  it("has its live region in the page before there is anything to say", () => {
    render(<Toasts />);
    // A screen reader only announces changes to a region that was already in
    // the tree; one created with its first toast announces nothing, ever.
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });

  it("puts the toast inside that same region rather than making a new one", () => {
    render(<Toasts />);
    const region = screen.getByRole("status");
    act(() => useUI.getState().toast("Message could not be sent.", "error"));
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Message could not be sent.");
  });

  it("says which kind of toast it is, since the colour of a border is the only other signal", () => {
    render(<Toasts />);
    act(() => useUI.getState().toast("Saved.", "success"));
    act(() => useUI.getState().toast("Nope.", "error"));
    const kinds = screen.getAllByRole("button").map((b) => b.querySelector(".visually-hidden")?.textContent ?? "");
    expect(kinds.every((k) => k.trim().length > 0)).toBe(true);
    expect(new Set(kinds).size).toBe(2);
    // an error interrupts; the rest wait for a pause
    expect(screen.getByText("Nope.", { exact: false }).closest("[role=alert]")).toBeTruthy();
  });
});
