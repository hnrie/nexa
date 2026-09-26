import { describe, expect, it } from "vitest";
import { dominantColor } from "./dominantColor";

/** RGBA pixels: `n` of each colour given. */
function pixels(...runs: [number, [number, number, number, number]][]): number[] {
  const out: number[] = [];
  for (const [n, px] of runs) for (let i = 0; i < n; i++) out.push(...px);
  return out;
}

describe("dominantColor", () => {
  it("gives a flat picture's own colour", () => {
    expect(dominantColor(pixels([64, [155, 89, 182, 255]]))).toBe("#9b59b6");
  });

  it("prefers the logo to the plain ground around it", () => {
    // half white ground, a third of it a blue logo
    expect(dominantColor(pixels([300, [255, 255, 255, 255]], [150, [40, 120, 220, 255]]))).toBe("#2878dc");
    expect(dominantColor(pixels([300, [0, 0, 0, 255]], [150, [236, 142, 58, 255]]))).toBe("#ec8e3a");
  });

  it("still answers for a picture in greys only", () => {
    expect(dominantColor(pixels([10, [128, 128, 128, 255]]))).toBe("#808080");
  });

  it("leaves out transparent pixels, and has nothing to say about a clear picture", () => {
    expect(dominantColor(pixels([100, [255, 0, 0, 0]], [4, [0, 200, 0, 255]]))).toBe("#00c800");
    expect(dominantColor(pixels([16, [10, 20, 30, 0]]))).toBeNull();
    expect(dominantColor([])).toBeNull();
  });
});
