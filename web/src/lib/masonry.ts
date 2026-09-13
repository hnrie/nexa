/**
 * Lays pictures out in columns of equal width, each going under whichever
 * column is shortest so far, the way GIF pickers do. Only the ones near what
 * is on screen need to exist at all.
 */

export interface Tile {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Masonry {
  tiles: Tile[];
  /** From the top of the first tile to the bottom of the lowest one. */
  height: number;
}

/**
 * Places `count` tiles in `cols` columns across `width`. heightOf gives each
 * tile's height at the column width; appending tiles never moves earlier ones.
 */
export function masonry(count: number, width: number, cols: number, gap: number, heightOf: (index: number, colWidth: number) => number): Masonry {
  const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
  if (count <= 0 || cols <= 0 || colWidth <= 0) return { tiles: [], height: 0 };
  const bottoms = new Array<number>(cols).fill(0);
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    let col = 0;
    for (let c = 1; c < cols; c++) if (bottoms[c]! < bottoms[col]!) col = c;
    const height = Math.max(1, Math.round(heightOf(i, colWidth)));
    tiles.push({ top: bottoms[col]!, left: col * (colWidth + gap), width: colWidth, height });
    bottoms[col] = bottoms[col]! + height + gap;
  }
  return { tiles, height: Math.max(...bottoms) - gap };
}

/** The indexes of the tiles that reach into [from, to). */
export function tilesWithin(tiles: Tile[], from: number, to: number): number[] {
  const out: number[] = [];
  tiles.forEach((t, i) => {
    if (t.top < to && t.top + t.height > from) out.push(i);
  });
  return out;
}

/**
 * A GIF's height for its width: its own shape when known, square when not,
 * and kept from being a sliver or a tower.
 */
export function gifHeight(colWidth: number, w?: number, h?: number): number {
  const ratio = w && h ? h / w : 1;
  return colWidth * Math.min(2, Math.max(0.4, ratio));
}
