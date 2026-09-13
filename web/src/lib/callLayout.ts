/**
 * Lays call tiles out the way a video call should: every tile the same 16:9
 * shape, as large as they can be while all of them still fit, in rows that
 * sit in the middle of the space.
 */

export interface Grid {
  cols: number;
  rows: number;
  width: number;
  height: number;
}

export function fitGrid(count: number, boxW: number, boxH: number, gap = 8, aspect = 16 / 9): Grid {
  if (count <= 0 || boxW <= 0 || boxH <= 0) return { cols: 0, rows: 0, width: 0, height: 0 };
  let best: Grid = { cols: 1, rows: count, width: 0, height: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const width = Math.min((boxW - gap * (cols - 1)) / cols, ((boxH - gap * (rows - 1)) / rows) * aspect);
    if (width > best.width) best = { cols, rows, width, height: width / aspect };
  }
  return { cols: best.cols, rows: best.rows, width: Math.max(0, Math.floor(best.width)), height: Math.max(0, Math.floor(best.height)) };
}
