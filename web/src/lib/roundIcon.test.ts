// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { roundAvatar } from "./roundIcon";

/** A canvas that records what was drawn on it: jsdom has none of its own. */
function fakeCanvas() {
  const calls: string[] = [];
  const ctx = {
    beginPath: () => calls.push("beginPath"),
    arc: () => calls.push("arc"),
    closePath: () => calls.push("closePath"),
    clip: () => calls.push("clip"),
    fillRect: () => calls.push("fillRect"),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    drawImage: () => calls.push("drawImage"),
    set fillStyle(v: string) {
      calls.push(`fillStyle:${v}`);
    },
    textAlign: "",
    textBaseline: "",
    font: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => "data:image/png;base64,ROUND");
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("roundAvatar", () => {
  it("draws someone without a picture as their initial on their colour, inside a circle", async () => {
    const calls = fakeCanvas();
    const icon = await roundAvatar({ id: "42", name: "nora", url: null }, "/icons/icon-192.png");
    expect(icon).toBe("data:image/png;base64,ROUND");
    // the circle is the clip, laid down before anything is painted
    expect(calls.indexOf("clip")).toBeLessThan(calls.indexOf("fillRect"));
    expect(calls).toContain("fillText:N");
  });

  it("falls back to the picture itself, and then to the app's icon, where nothing can be drawn", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    expect(await roundAvatar({ id: "7", name: "Bob", url: null }, "/icons/icon-192.png")).toBe("/icons/icon-192.png");
    vi.useFakeTimers();
    const pending = roundAvatar({ id: "8", name: "Ann", url: "/media/avatar/8" }, "/icons/icon-192.png");
    // a picture that never arrives does not hold the notification up for long
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe("/media/avatar/8");
  });
});
