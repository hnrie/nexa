/**
 * The changes made in a note that never reached the server: the note was
 * closed while offline, or while sending was being refused. Kept in memory
 * until the note is opened again, where they go back into it and are sent
 * (session.ts), so leaving a note never loses what was written in it while
 * the tab is open. Never on disk: it is what was written, in the clear.
 */

const unsent = new Map<string, Uint8Array>();

export function keepUnsent(id: string, changes: Uint8Array): void {
  unsent.set(id, changes);
}

/** The changes left unsent in a note, once: the caller puts them back. */
export function takeUnsent(id: string): Uint8Array | null {
  const left = unsent.get(id) ?? null;
  unsent.delete(id);
  return left;
}

export function forgetUnsent(id?: string): void {
  if (id === undefined) unsent.clear();
  else unsent.delete(id);
}
