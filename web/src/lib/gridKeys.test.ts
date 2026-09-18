import { describe, expect, it } from "vitest";
import { nextCell } from "./gridKeys";

/** Four columns of 100px, rows of 100px: an ordinary wrapping grid. */
const grid = Array.from({ length: 10 }, (_, i) => ({ left: (i % 4) * 100, top: Math.floor(i / 4) * 100 }));

/** Three masonry columns whose rows never line up. */
const masonry = [
  { left: 0, top: 0 },
  { left: 100, top: 0 },
  { left: 200, top: 0 },
  { left: 0, top: 150 },
  { left: 100, top: 80 },
  { left: 200, top: 220 },
];

describe("nextCell", () => {
  it("walks a wrapping grid the way it looks", () => {
    expect(nextCell(grid, 0, "ArrowRight")).toBe(1);
    expect(nextCell(grid, 3, "ArrowRight")).toBe(4);
    expect(nextCell(grid, 0, "ArrowDown")).toBe(4);
    expect(nextCell(grid, 5, "ArrowUp")).toBe(1);
    expect(nextCell(grid, 0, "End")).toBe(9);
    expect(nextCell(grid, 9, "Home")).toBe(0);
  });

  it("stops at the edges rather than wrapping round", () => {
    expect(nextCell(grid, 0, "ArrowLeft")).toBeNull();
    expect(nextCell(grid, 9, "ArrowRight")).toBeNull();
    expect(nextCell(grid, 1, "ArrowUp")).toBeNull();
    expect(nextCell(grid, 9, "ArrowDown")).toBeNull();
  });

  it("finds the row below by where things are, not by index", () => {
    // straight down from the first tile is the one at 150, not the one at 80
    expect(nextCell(masonry, 0, "ArrowDown")).toBe(3);
    // from the middle column, the nearest row below is its own next tile
    expect(nextCell(masonry, 1, "ArrowDown")).toBe(4);
    // and up from the right-hand column is the tile above it in that column
    expect(nextCell(masonry, 5, "ArrowUp")).toBe(2);
    expect(nextCell(masonry, 3, "ArrowUp")).toBe(0);
  });

  it("starts somewhere sensible when nothing is focused yet", () => {
    expect(nextCell(grid, -1, "ArrowDown")).toBe(0);
    expect(nextCell(grid, -1, "ArrowUp")).toBe(9);
    expect(nextCell([], -1, "ArrowDown")).toBeNull();
  });
});
