import type { NoteDoc } from "./model";

/**
 * What a note said when it was closed without the server having it: closed
 * while offline, or while a save was being refused. Kept in memory until the
 * note is opened again, where it is put back into the note (open.ts), so
 * leaving a note never loses what was written in it while the tab is open.
 * Never on disk: it is the note in the clear.
 */
export interface Unsent {
  /** The note as it was on the page. */
  doc: NoteDoc;
  /** The note as the server had it when that was written. */
  base: NoteDoc;
}

const unsent = new Map<string, Unsent>();

export function keepUnsent(id: string, left: Unsent): void {
  unsent.set(id, left);
}

/** What was left unsent in a note, once: the caller puts it back. */
export function takeUnsent(id: string): Unsent | null {
  const left = unsent.get(id) ?? null;
  unsent.delete(id);
  return left;
}

export function forgetUnsent(id?: string): void {
  if (id === undefined) unsent.clear();
  else unsent.delete(id);
}
