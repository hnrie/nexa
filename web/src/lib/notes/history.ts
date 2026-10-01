import { notes as notesApi } from "@/api/notes";
import type { NoteVersionRow } from "@/api/types";
import { noteKeyAt, openNote } from "@/crypto/notes";
import { refreshNote } from "@/stores/notes";
import { readBody, readHead, type NoteDoc, type NoteHead } from "./model";

/**
 * A note's earlier states.
 *
 * The server sets a state aside when writing starts again after a pause,
 * every so often while it goes on, and whenever one is about to be put back.
 * Each is sealed as it was, with the key the note had then; a note's earlier
 * keys are kept sealed each with the one after it, so whoever holds the
 * note's key now can open all of them.
 */

export interface NoteVersionItem {
  id: string;
  /** The version of the note this state was. */
  version: number;
  savedAt: number;
  editedBy: string | null;
  /** Its title and first lines; null when it could not be opened. */
  head: NoteHead | null;
  /** Which of the note's keys it is sealed with. */
  epoch: number;
}

export interface NoteHistory {
  versions: NoteVersionItem[];
  /** Opens one of them in full. */
  open: (versionId: string) => Promise<NoteDoc>;
}

/** The note's earlier states, newest first, with their heads opened. */
export async function loadNoteHistory(noteId: string): Promise<NoteHistory> {
  // the note is asked for with them: its key now is what opens every earlier one
  const [res, note] = await Promise.all([notesApi.versions(noteId), refreshNote(noteId)]);
  const now = { key: note.key, epoch: note.row.key_epoch };
  const wrapped: Record<number, string> = {};
  for (const k of res.keys) wrapped[k.epoch] = k.wrapped;
  // each earlier key is opened once, however many versions it sealed
  const keys = new Map<number, Promise<Uint8Array>>();
  const keyAt = (epoch: number): Promise<Uint8Array> => {
    let k = keys.get(epoch);
    if (!k) {
      k = noteKeyAt(now.key, now.epoch, epoch, wrapped);
      keys.set(epoch, k);
      // a key that cannot be opened is not remembered as a failure for the next look
      k.catch(() => keys.delete(epoch));
    }
    return k;
  };
  const versions = await Promise.all(
    res.versions.map(async (v: NoteVersionRow): Promise<NoteVersionItem> => {
      let head: NoteHead | null = null;
      try {
        head = readHead(await openNote(await keyAt(v.key_epoch), "head", v.head));
      } catch {
        head = null;
      }
      return { id: v.id, version: v.version, savedAt: v.saved_at, editedBy: v.edited_by, head, epoch: v.key_epoch };
    }),
  );
  return {
    versions,
    open: async (versionId) => {
      const v = await notesApi.version(noteId, versionId);
      const key = await keyAt(v.key_epoch);
      const [head, body] = await Promise.all([openNote(key, "head", v.head), openNote(key, "body", v.body ?? "")]);
      const b = readBody(body);
      return { title: readHead(head).title, md: b.md, files: b.files };
    },
  };
}
