// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the clipboard when it is there", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText("abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to copying a selection when the clipboard refuses", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")) });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    await expect(copyText("abc")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    // the helper leaves nothing behind in the page
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("answers false, without throwing, when nothing could copy (plain http)", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    await expect(copyText("abc")).resolves.toBe(false);
  });
});
