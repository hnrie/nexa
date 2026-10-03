import type { RailDrop } from "./railLayout";

/**
 * Where a server or folder dragged over the rail would land, worked out from
 * where the pointer is against the rows as they are drawn.
 *
 * Every row used to take its own drops, so the 10 px between two tiles, the
 * foot of an open folder and the strip under it took none: let go there and
 * nothing happened, while the line from the last row passed still showed
 * where it would have gone. Taking a server out of a folder only worked on a
 * 12 px strip at the top of the next tile. Here the whole rail is one target:
 * each entry owns the space down to halfway to the next, so a gap belongs to
 * the edge nearest it, and an open folder ends at the foot of its sleeve.
 * Below that is outside it.
 */

/** One row of the rail as drawn: a server's tile, or a folder's own tile. */
export interface RailRow {
  /** The server's id, or the folder's for its tile. */
  id: string;
  /** This row is a folder's tile. */
  folder: boolean;
  /** For a server shown in an open folder: that folder's id. */
  parent?: string;
  /** For an open folder's tile: where its sleeve ends, under its last server. */
  end?: number;
  top: number;
  bottom: number;
}

/** What is being dragged: a server, or a whole folder. */
export interface RailDrag {
  id: string;
  folder: boolean;
}

/**
 * How much of a tile, from its middle, puts a dragged server onto it (a new
 * folder of the two, or into the folder) rather than beside it. The edges
 * between tiles are the more common aim, so they get the larger share.
 */
const COMBINE_FROM = 0.3;
const COMBINE_TO = 0.7;
/** The top of an open folder's tile goes above the folder; the rest of it, in at the top. */
const OPEN_TILE_ABOVE = 0.35;

/** Where a drop at `y` lands, or null where it would do nothing. */
export function railDropAt(rows: RailRow[], drag: RailDrag, y: number): RailDrop | null {
  // what is dragged is not a place to drop it, nor, for a folder, are its own servers
  const shown = rows.filter((r) => r.id !== drag.id && !(drag.folder && r.parent === drag.id));
  const entries = shown.filter((r) => !r.parent);
  if (entries.length === 0) return null;
  const extentEnd = (r: RailRow) => (r.folder && r.end !== undefined ? Math.max(r.bottom, r.end) : r.bottom);

  // the entry whose share of the rail the pointer is in: each reaches halfway to its neighbours
  let i = 0;
  while (i < entries.length - 1 && y > (extentEnd(entries[i]!) + entries[i + 1]!.top) / 2) i++;
  const e = entries[i]!;
  const height = Math.max(1, e.bottom - e.top);
  const at = (y - e.top) / height;

  // a folder goes beside other entries, never among a folder's servers or into one
  if (drag.folder) return { id: e.id, where: y < (e.top + extentEnd(e)) / 2 ? "before" : "after" };

  const children = e.folder && e.end !== undefined ? shown.filter((r) => r.parent === e.id) : [];
  const open = e.folder && e.end !== undefined;
  if (!open) {
    if (at < COMBINE_FROM) return { id: e.id, where: "before" };
    if (at > COMBINE_TO) return { id: e.id, where: "after" };
    return { id: e.id, where: "combine" };
  }

  // An open folder: above its tile's top is above the folder, the rest of the
  // tile is in at its top, then among its servers, and past the foot of its
  // sleeve is outside it again.
  if (at < OPEN_TILE_ABOVE) return { id: e.id, where: "before" };
  if (y > extentEnd(e)) return { id: e.id, where: "after" };
  const first = children[0];
  if (!first) {
    // the server dragged is the only one in it: inside is where it already is
    return null;
  }
  if (y <= e.bottom) return { id: first.id, where: "before" };
  let j = 0;
  while (j < children.length - 1 && y > (children[j]!.bottom + children[j + 1]!.top) / 2) j++;
  const c = children[j]!;
  return { id: c.id, where: y < (c.top + c.bottom) / 2 ? "before" : "after" };
}
