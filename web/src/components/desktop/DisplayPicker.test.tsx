// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplaySourceRequest } from "@/lib/desktopBridge";
import { DisplayPicker } from "./DisplayPicker";

afterEach(cleanup);

const request: DisplaySourceRequest = {
  requestId: "r1",
  audio: false,
  sources: [
    { id: "screen:1", name: "Entire screen", kind: "screen", thumbnail: "" },
    { id: "window:1", name: "Mail", kind: "window", thumbnail: "" },
    { id: "window:2", name: "Editor", kind: "window", thumbnail: "" },
  ],
};

const share = () => screen.getByTestId("display-share") as HTMLButtonElement;
const tabs = () => screen.getAllByRole("tab");

describe("DisplayPicker", () => {
  it("never shares the screen picked on the other tab", () => {
    const onChoose = vi.fn();
    render(<DisplayPicker request={request} onChoose={onChoose} />);
    // one screen: it starts picked, so Share is ready
    expect(share().disabled).toBe(false);
    fireEvent.click(tabs()[1]!);
    // on Windows nothing is picked yet, so there is nothing to share
    expect(share().disabled).toBe(true);
    fireEvent.click(share());
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Editor").closest("button")!);
    fireEvent.click(share());
    expect(onChoose).toHaveBeenCalledWith("window:2", false);
  });

  it("keeps each tab's pick, and gives the Windows tab a stop for the keyboard", () => {
    render(<DisplayPicker request={request} onChoose={vi.fn()} />);
    fireEvent.click(tabs()[1]!);
    const radios = screen.getAllByRole("radio");
    // nothing picked here: the first window is the group's one tab stop
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    // arrows move the pick, as a radio group does
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    fireEvent.keyDown(screen.getAllByRole("radio")[1]!, { key: "ArrowRight" });
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    // back on Screens, the screen is still the pick
    fireEvent.click(tabs()[0]!);
    expect(screen.getAllByRole("radio")[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("shares the focused source on Enter", () => {
    const onChoose = vi.fn();
    render(<DisplayPicker request={request} onChoose={onChoose} />);
    fireEvent.click(tabs()[1]!);
    fireEvent.keyDown(screen.getAllByRole("radio")[1]!, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("window:2", false);
  });
});
