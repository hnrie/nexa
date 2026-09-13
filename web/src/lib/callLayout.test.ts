import { fitGrid } from "./callLayout";

describe("fitGrid", () => {
  it("fills the space with one tile", () => {
    expect(fitGrid(1, 1280, 720, 8)).toEqual({ cols: 1, rows: 1, width: 1280, height: 720 });
    // too tall a space: the width decides
    expect(fitGrid(1, 400, 900, 8)).toEqual({ cols: 1, rows: 1, width: 400, height: 225 });
  });

  it("puts two side by side on a wide screen and stacks them on a phone", () => {
    expect(fitGrid(2, 1280, 720, 8)).toMatchObject({ cols: 2, rows: 1, width: 636 });
    expect(fitGrid(2, 360, 600, 8)).toMatchObject({ cols: 1, rows: 2, width: 360 });
  });

  it("picks whichever column count makes the tiles largest", () => {
    expect(fitGrid(3, 1000, 800, 8)).toMatchObject({ cols: 2, rows: 2 });
    expect(fitGrid(3, 1600, 400, 8)).toMatchObject({ cols: 3, rows: 1 });
    expect(fitGrid(9, 1280, 720, 8)).toMatchObject({ cols: 3, rows: 3 });
  });

  it("never lets the tiles overflow", () => {
    for (const [n, w, h] of [[5, 900, 500], [7, 390, 700], [12, 1920, 1000], [4, 320, 180]] as const) {
      const g = fitGrid(n, w, h, 8);
      expect(g.cols * g.width + (g.cols - 1) * 8).toBeLessThanOrEqual(w);
      expect(g.rows * g.height + (g.rows - 1) * 8).toBeLessThanOrEqual(h);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
    }
  });

  it("has nothing to lay out in no space", () => {
    expect(fitGrid(0, 800, 600)).toEqual({ cols: 0, rows: 0, width: 0, height: 0 });
    expect(fitGrid(3, 0, 600)).toEqual({ cols: 0, rows: 0, width: 0, height: 0 });
  });
});
