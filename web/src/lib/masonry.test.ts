import { gifHeight, masonry, tilesWithin } from "./masonry";

describe("masonry", () => {
  it("stays inside the width, in columns, never side by side past them", () => {
    const heights = [100, 50, 80, 120, 60, 90, 70];
    const m = masonry(heights.length, 482, 2, 8, (i) => heights[i]!);
    expect(new Set(m.tiles.map((t) => t.left))).toEqual(new Set([0, 245]));
    for (const t of m.tiles) expect(t.left + t.width).toBeLessThanOrEqual(482);
  });

  it("puts each tile under the shortest column", () => {
    const heights = [100, 50, 80, 120];
    const m = masonry(heights.length, 208, 2, 8, (i) => heights[i]!);
    expect(m.tiles.map(({ top, left }) => [top, left])).toEqual([
      [0, 0],
      [0, 108],
      [58, 108], // under the 50 tall one
      [108, 0], // left column (108) is now shorter than the right (146)
    ]);
    expect(m.height).toBe(228);
  });

  it("never overlaps tiles in a column", () => {
    const m = masonry(40, 390, 2, 8, (i, w) => gifHeight(w, 100 + ((i * 37) % 300), 100 + ((i * 53) % 300)));
    for (const a of m.tiles)
      for (const b of m.tiles)
        if (a !== b && a.left === b.left) expect(a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true);
    expect(m.height).toBe(Math.max(...m.tiles.map((t) => t.top + t.height)));
  });

  it("does not move the tiles already placed when more are added", () => {
    const h = (i: number, w: number) => gifHeight(w, 200 + i * 13, 150 + i * 7);
    const first = masonry(10, 480, 2, 8, h);
    const more = masonry(25, 480, 2, 8, h);
    expect(more.tiles.slice(0, 10)).toEqual(first.tiles);
  });

  it("has nothing to lay out without room or tiles", () => {
    expect(masonry(0, 480, 2, 8, () => 10)).toEqual({ tiles: [], height: 0 });
    expect(masonry(5, 0, 2, 8, () => 10)).toEqual({ tiles: [], height: 0 });
  });
});

describe("tilesWithin", () => {
  it("keeps only the tiles that reach into the window", () => {
    const m = masonry(6, 208, 2, 8, () => 100);
    // rows at 0, 108 and 216
    expect(tilesWithin(m.tiles, 0, 100)).toEqual([0, 1]);
    expect(tilesWithin(m.tiles, 150, 250)).toEqual([2, 3, 4, 5]);
    expect(tilesWithin(m.tiles, 400, 900)).toEqual([]);
  });
});

describe("gifHeight", () => {
  it("keeps the GIF's shape within limits", () => {
    expect(gifHeight(200, 400, 300)).toBe(150);
    expect(gifHeight(200)).toBe(200);
    expect(gifHeight(200, 1000, 50)).toBe(80);
    expect(gifHeight(200, 50, 1000)).toBe(400);
  });
});
