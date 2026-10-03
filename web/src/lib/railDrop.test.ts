import { describe, expect, it } from "vitest";
import { railDropAt, type RailRow } from "./railDrop";

/**
 * The rail as drawn: 48 px tiles 10 px apart, an open folder's servers in its
 * sleeve under its tile, and the sleeve 5 px longer than its last server.
 */
function draw(entries: (string | { id: string; servers?: string[] })[]): RailRow[] {
  const rows: RailRow[] = [];
  let y = 0;
  for (const e of entries) {
    if (typeof e === "string") {
      rows.push({ id: e, folder: false, top: y, bottom: y + 48 });
      y += 58;
      continue;
    }
    const tile: RailRow = { id: e.id, folder: true, top: y, bottom: y + 48 };
    rows.push(tile);
    y += 58;
    if (e.servers) {
      for (const s of e.servers) {
        rows.push({ id: s, folder: false, parent: e.id, top: y, bottom: y + 48 });
        y += 58;
      }
      // the sleeve ends 5 px under the last server, then the rail's gap
      tile.end = y - 10 + 5;
      y += 5;
    }
  }
  return rows;
}

const server = (id: string) => ({ id, folder: false });

describe("railDropAt", () => {
  // X 0-48, F 58-106 open: A 116-164, B 174-222, sleeve to 227; Y 237-285
  const rows = draw(["X", { id: "F", servers: ["A", "B"] }, "Y"]);

  it("lets a server out of a folder below it, gap and all", () => {
    // the strip under the sleeve, the gap, and the top of the next tile
    for (const y of [228, 232, 236, 240]) expect(railDropAt(rows, server("A"), y)).toEqual({ id: expect.stringMatching(/^(F|Y)$/), where: expect.stringMatching(/^(after|before)$/) });
    expect(railDropAt(rows, server("A"), 230)).toEqual({ id: "F", where: "after" });
    expect(railDropAt(rows, server("A"), 240)).toEqual({ id: "Y", where: "before" });
  });

  it("keeps it inside down to the foot of the sleeve", () => {
    expect(railDropAt(rows, server("A"), 210)).toEqual({ id: "B", where: "after" });
    expect(railDropAt(rows, server("A"), 226)).toEqual({ id: "B", where: "after" });
    expect(railDropAt(rows, server("A"), 180)).toEqual({ id: "B", where: "before" });
  });

  it("lets it out above the folder from the top of the folder's tile", () => {
    expect(railDropAt(rows, server("B"), 55)).toEqual({ id: "F", where: "before" });
    expect(railDropAt(rows, server("B"), 62)).toEqual({ id: "F", where: "before" });
    // the rest of the tile is in at the top
    expect(railDropAt(rows, server("B"), 90)).toEqual({ id: "A", where: "before" });
  });

  it("gives the gaps between tiles to the nearest edge, never to nothing", () => {
    // between X (ends 48) and F (starts 58)
    expect(railDropAt(rows, server("Y"), 50)).toEqual({ id: "X", where: "after" });
    expect(railDropAt(rows, server("Y"), 56)).toEqual({ id: "F", where: "before" });
    // above the first and below the last
    expect(railDropAt(rows, server("Y"), -20)).toEqual({ id: "X", where: "before" });
    expect(railDropAt(rows, server("X"), 400)).toEqual({ id: "Y", where: "after" });
  });

  it("puts a server onto another only from its middle", () => {
    expect(railDropAt(rows, server("A"), 24)).toEqual({ id: "X", where: "combine" });
    expect(railDropAt(rows, server("A"), 10)).toEqual({ id: "X", where: "before" });
    expect(railDropAt(rows, server("A"), 40)).toEqual({ id: "X", where: "after" });
  });

  it("puts a folder only beside things, beside a folder for its servers", () => {
    const two = draw(["X", { id: "F", servers: ["A", "B"] }, { id: "G" }]);
    expect(railDropAt(two, { id: "G", folder: true }, 24)).toEqual({ id: "X", where: "after" });
    expect(railDropAt(two, { id: "G", folder: true }, 130)).toEqual({ id: "F", where: "before" });
    expect(railDropAt(two, { id: "G", folder: true }, 200)).toEqual({ id: "F", where: "after" });
    // a folder dragged skips its own servers: its own space is either side of where it is
    expect(railDropAt(rows, { id: "F", folder: true }, 100)).toEqual({ id: "X", where: "after" });
    expect(railDropAt(rows, { id: "F", folder: true }, 150)).toEqual({ id: "Y", where: "before" });
  });

  it("does nothing inside a folder whose only server is the one dragged", () => {
    const lone = draw(["X", { id: "F", servers: ["A"] }, "Y"]);
    expect(railDropAt(lone, server("A"), 140)).toBeNull();
    // but above or below it, it leaves
    expect(railDropAt(lone, server("A"), 60)).toEqual({ id: "F", where: "before" });
    expect(railDropAt(lone, server("A"), 172)).toEqual({ id: "F", where: "after" });
  });
});
