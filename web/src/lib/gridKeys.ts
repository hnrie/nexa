/**
 * Arrow keys over a grid whose shape only exists once it has been laid out.
 *
 * The sticker grid wraps at whatever the CSS grid decided, and the GIF grid is
 * a masonry where no two columns have the same rows at all. Neither knows how
 * many columns it has, so "the cell below" is a geometric question: the nearest
 * cell that starts lower down, measured from where this one starts.
 *
 * Every cell is otherwise its own tab stop — hundreds of them in a picker —
 * which is why the container takes the one stop and these move within it.
 */

export interface CellBox {
  left: number;
  top: number;
}

/** Where the arrows go from `from`, or null when they go nowhere. */
export function nextCell(boxes: CellBox[], from: number, key: string): number | null {
  if (boxes.length === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return boxes.length - 1;
  if (from < 0 || from >= boxes.length) return key === "ArrowUp" || key === "ArrowLeft" ? boxes.length - 1 : 0;
  if (key === "ArrowRight") return from + 1 < boxes.length ? from + 1 : null;
  if (key === "ArrowLeft") return from > 0 ? from - 1 : null;
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  const here = boxes[from]!;
  const down = key === "ArrowDown";
  // "a row below" rather than "the next index": a masonry column can be two
  // tiles ahead of the one beside it. The nearest such row first, then the
  // cell in it that starts closest to where this one starts.
  const beyond = boxes.map((b, i) => ({ b, i })).filter(({ b }) => (down ? b.top > here.top : b.top < here.top));
  if (beyond.length === 0) return null;
  // Column first, then row: down from the left-hand column should stay in the
  // left-hand column even when the middle one happens to have a tile sooner.
  const dx = beyond.reduce((acc, { b }) => Math.min(acc, Math.abs(b.left - here.left)), Infinity);
  const column = beyond.filter(({ b }) => Math.abs(b.left - here.left) === dx);
  return column.reduce((acc, cur) => ((down ? cur.b.top < boxes[acc]!.top : cur.b.top > boxes[acc]!.top) ? cur.i : acc), column[0]!.i);
}

/**
 * Moves focus within `container` for an arrow, Home or End, and says whether it
 * handled the key. Cells are whatever matches `selector` and are expected to
 * carry `tabIndex={-1}`, so the container itself is the only tab stop.
 */
export function moveFocusInGrid(container: HTMLElement, selector: string, key: string): boolean {
  if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return false;
  if (key === "Home" || key === "End") {
    // A virtualised grid holds only a window of itself, so the first cell in
    // the DOM is not the first cell there is: scroll, then take whatever is at
    // that end once it has been drawn.
    //
    // It takes a few frames. The grid answers the scroll on its own frame and
    // draws the window it moved to on the next, unmounting whatever had focus
    // on the way — and `focus()` would scroll the old cell back into view and
    // undo the jump, hence `preventScroll`. Re-asserting the scroll each frame
    // converges instead of racing.
    const top = key === "Home" ? 0 : container.scrollHeight;
    let frames = 0;
    const settle = (): void => {
      container.scrollTop = top;
      const cells = [...container.querySelectorAll<HTMLElement>(selector)];
      if (cells.length > 0) {
        const base = container.getBoundingClientRect();
        const sorted = cells
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { el, top: Math.round(r.top - base.top), left: Math.round(r.left - base.left) };
          })
          .sort((a, b) => a.top - b.top || a.left - b.left);
        (key === "Home" ? sorted[0] : sorted[sorted.length - 1])?.el.focus({ preventScroll: true });
      }
      frames += 1;
      if (frames < 4) requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
    return true;
  }
  const cells = [...container.querySelectorAll<HTMLElement>(selector)];
  if (cells.length === 0) return false;
  // Measured against the container rather than read off offsetLeft/offsetTop:
  // a masonry tile is its own positioned ancestor, so the button inside it
  // reports 0, 0 and every cell looks like it is in the same place.
  const base = container.getBoundingClientRect();
  const boxes = cells.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left - base.left + container.scrollLeft), top: Math.round(r.top - base.top + container.scrollTop) };
  });
  // Left, right, Home and End follow reading order, which is where things
  // ended up rather than the order they were rendered in — a virtualised grid
  // does not always put them in the DOM in the order they are drawn.
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a]!.top - boxes[b]!.top || boxes[a]!.left - boxes[b]!.left);
  const read = order.map((i) => boxes[i]!);
  const at = order.indexOf(cells.indexOf(document.activeElement as HTMLElement));
  const to = nextCell(read, at, key);
  if (to === null) return true;
  cells[order[to]!]?.focus();
  return true;
}
