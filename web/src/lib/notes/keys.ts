import { DecryptError } from "@/crypto/keys";
import { openNoteKey } from "@/crypto/notes";
import { useKeys } from "@/stores/keys";

/**
 * The keys of this account's notes, opened.
 *
 * Each note's key comes sealed to this account. Opening one is a public-key
 * operation, so it is done once and the result kept here, in memory only:
 * never in a store's state, where a devtools snapshot or a persisted store
 * would carry it, and never on disk. They go when the tab does, and when the
 * session locks or ends.
 */

interface Held {
  sealed: string;
  key: Uint8Array;
  epoch: number;
}

const held = new Map<string, Held>();

/** A note as far as its key goes: any row the server sends for one. */
export interface KeyedNote {
  id: string;
  key_sealed: string;
  key_epoch: number;
}

/** Opens (or returns) the key a note's row carries for this account. */
export async function noteKeyOf(row: KeyedNote): Promise<Uint8Array> {
  const have = held.get(row.id);
  if (have && have.sealed === row.key_sealed) return have.key;
  const identity = useKeys.getState().identity;
  if (!identity) throw new DecryptError("this device's keys are not open");
  const key = await openNoteKey(identity, row.key_sealed);
  // a slower answer about an older key does not replace a newer one
  const now = held.get(row.id);
  if (!now || now.epoch <= row.key_epoch) held.set(row.id, { sealed: row.key_sealed, key, epoch: row.key_epoch });
  return key;
}

/** The key held for a note and which of the note's keys it is, if it has been opened. */
export function heldNoteKey(id: string): { key: Uint8Array; epoch: number } | null {
  const have = held.get(id);
  return have ? { key: have.key, epoch: have.epoch } : null;
}

export function forgetNoteKey(id: string): void {
  held.delete(id);
}

/** Lets go of every key but those of the notes named: the notes this account is still in. */
export function keepNoteKeys(ids: Set<string>): void {
  for (const id of [...held.keys()]) if (!ids.has(id)) held.delete(id);
}

export function forgetNoteKeys(): void {
  held.clear();
}
