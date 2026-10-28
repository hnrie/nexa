// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/imageActions", async (original) => ({ ...await original<typeof import("@/lib/imageActions")>(), saveImage: vi.fn().mockResolvedValue(undefined) }));
import { saveImage } from "@/lib/imageActions";
import { Lightbox } from "./Lightbox";
import { barsOf } from "./waveform";
import { mediaPrefs, saveMediaPrefs } from "./mediaPrefs";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const pictures = [
  { src: "blob:a", name: "first.png" },
  { src: "blob:b", name: "second.png" },
  { src: "blob:c", name: "third.png" },
];

describe("Lightbox", () => {
  it("is a modal dialog that takes focus, with its controls in a bar and the picture's name", () => {
    render(<Lightbox items={pictures} start={1} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "second.png" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(saveImage).toHaveBeenCalledWith("blob:b", "second.png");
  });

  it("steps through a message's pictures with the arrows, and stops at either end", () => {
    render(<Lightbox items={pictures} start={0} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(screen.queryByRole("button", { name: "Previous Picture" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("second.png");
    fireEvent.click(screen.getByRole("button", { name: "Next Picture" }));
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("third.png");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("third.png");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("second.png");
  });

  it("closes on Escape without the key reaching the panels behind it", () => {
    const onClose = vi.fn();
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    render(<Lightbox items={pictures.slice(0, 1)} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind);
  });

  it("closes at once on a click beside the picture", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<Lightbox items={pictures.slice(0, 1)} onClose={onClose} />);
    const stage = container.ownerDocument.querySelector("[data-testid=lightbox] img")!.parentElement!;
    act(() => {
      fireEvent.click(stage);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("voice note waveform", () => {
  it("draws each slice's loudness, the loudest at the top", () => {
    const samples = new Float32Array(480);
    for (let i = 240; i < 480; i++) samples[i] = i % 2 ? 0.5 : -0.5;
    const bars = barsOf(samples, 48);
    expect(bars).toHaveLength(48);
    // the silent first half sits on the floor, the loud second half at the top
    expect(bars[0]).toBeCloseTo(0.12);
    expect(bars[47]).toBeCloseTo(1);
  });
});

describe("media preferences", () => {
  it("are remembered, and kept in range", () => {
    expect(mediaPrefs()).toEqual({ volume: 1, muted: false, speed: 1 });
    saveMediaPrefs({ muted: true, speed: 1.5 });
    saveMediaPrefs({ volume: 7 });
    expect(mediaPrefs()).toEqual({ volume: 1, muted: true, speed: 1.5 });
  });
});
