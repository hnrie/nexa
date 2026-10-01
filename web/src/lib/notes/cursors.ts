import type { CursorMark, PlaceMark } from "@/components/composer/format/surface";

/**
 * Where someone's caret is in a note, as it goes over the gateway (sealed
 * with the note's key): which of their pages it is (`s`, so two tabs of one
 * person are two carets) and where the selection runs, or that the page has
 * closed the note.
 */
export type CursorMessage = { s: string; a: PlaceMark; f: PlaceMark } | { s: string; gone: true };

function readPlace(x: unknown): PlaceMark | null {
  if (typeof x !== "object" || x === null) return null;
  const v = x as Record<string, unknown>;
  const b = v["b"];
  const o = v["o"];
  const k = v["k"];
  if (typeof b !== "number" || typeof o !== "number" || !Number.isInteger(b) || !Number.isInteger(o) || b < 0 || o < 0 || b > 1_000_000 || o > 1_000_000) return null;
  if (typeof k !== "string" || k.length > 16) return null;
  const cell = v["cell"];
  if (cell !== undefined) {
    if (!Array.isArray(cell) || cell.length !== 2 || !cell.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 10_000)) return null;
    return { b, o, k, cell: [cell[0] as number, cell[1] as number] };
  }
  return { b, o, k };
}

/** A cursor someone else sent, read as carefully as anything from the wire; null for anything else. */
export function readCursor(x: unknown): CursorMessage | null {
  if (typeof x !== "object" || x === null) return null;
  const v = x as Record<string, unknown>;
  const s = v["s"];
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]{4,32}$/.test(s)) return null;
  if (v["gone"] === true) return { s, gone: true };
  const a = readPlace(v["a"]);
  const f = readPlace(v["f"]);
  return a && f ? { s, a, f } : null;
}

export function sameMark(x: CursorMark | null, y: CursorMark | null): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}
