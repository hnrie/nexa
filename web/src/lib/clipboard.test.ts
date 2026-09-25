// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUI } from "@/stores/ui";
import { copyText } from "./clipboard";

afterEach(() => {
  useUI.setState({ toasts: [] });
  vi.restoreAllMocks();
});

function clipboard(writeText: ((s: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

describe("copyText", () => {
  it("copies and says so", async () => {
    const write = vi.fn(() => Promise.resolve());
    clipboard(write);
    expect(await copyText("hello", "Text copied.")).toBe(true);
    expect(write).toHaveBeenCalledWith("hello");
    expect(useUI.getState().toasts.map((x) => [x.text, x.kind])).toEqual([["Text copied.", "success"]]);
  });

  it("says when the browser refuses, instead of leaving the old clipboard to be pasted", async () => {
    clipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    // jsdom has no execCommand("copy") that works, so the old way fails too
    document.execCommand = vi.fn(() => false);
    expect(await copyText("hello")).toBe(false);
    expect(useUI.getState().toasts.map((x) => x.kind)).toEqual(["error"]);
  });

  it("falls back to the old way where there is no clipboard at all", async () => {
    clipboard(undefined);
    document.execCommand = vi.fn(() => true);
    expect(await copyText("hello")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(useUI.getState().toasts.map((x) => x.kind)).toEqual(["success"]);
  });
});
