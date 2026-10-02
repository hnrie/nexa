/**
 * A note as a CRDT: the same note on every device that has it open, however
 * its people's edits cross.
 *
 * The note's text and title are Y.Texts and its files a Y.Map, in one Yjs
 * document. Each device turns what is typed there into the smallest edit
 * (textDiff.ts) and applies it to its own copy; the copy then says what
 * changed as a binary update, which goes to everyone else sealed with the
 * note's key, and every copy that has taken in the same updates, in whatever
 * order, reads the same. Two people typing in one sentence both keep their
 * words: nothing is merged after the fact, so nothing is doubled or lost.
 *
 * A saved note's body carries the whole document (`y`), and beside it the
 * text and files as plain values, for its preview, its history and any app
 * from before notes were kept this way.
 */

import * as Y from "yjs";
import { sha256 } from "@noble/hashes/sha256";
import { b64, utf8 } from "@/crypto/bytes";
import type { AttachmentMeta } from "@/crypto/message";
import { readBody, type NoteDoc } from "./model";
import { textDelta } from "./textDiff";

const MD = "md";
const TITLE = "title";
const FILES = "files";

/** The note's body as it is saved: the whole document, and the note as plain values beside it. */
export interface BodyV2 {
  v: 2;
  y: string;
  md: string;
  files: Record<string, AttachmentMeta>;
}

/** The note as its document holds it, read as carefully as anything someone else wrote. */
export function readDoc(doc: Y.Doc): NoteDoc {
  const files: Record<string, unknown> = {};
  doc.getMap(FILES).forEach((v, k) => {
    files[k] = v;
  });
  const body = readBody({ md: doc.getText(MD).toString(), files });
  return { title: doc.getText(TITLE).toString(), md: body.md, files: body.files };
}

/**
 * Puts what the page now holds into the document as the smallest edits that
 * get it there. Files are only ever added: one the text no longer shows is
 * left in the map, where someone else's undo can still find it, and saving
 * leaves it out of the note (model.ts, pruned).
 */
export function applyDoc(doc: Y.Doc, change: Partial<NoteDoc>, origin: unknown): boolean {
  let changed = false;
  doc.transact(() => {
    for (const [name, value] of [
      [TITLE, change.title],
      [MD, change.md],
    ] as const) {
      if (value === undefined) continue;
      const text = doc.getText(name);
      const delta = textDelta(text.toString(), value);
      if (delta.length) {
        text.applyDelta(delta);
        changed = true;
      }
    }
    if (change.files) {
      const map = doc.getMap(FILES);
      for (const [id, meta] of Object.entries(change.files)) {
        const was = map.get(id) as AttachmentMeta | undefined;
        if (was && was.blob_id === meta.blob_id && JSON.stringify(was) === JSON.stringify(meta)) continue;
        map.set(id, meta);
        changed = true;
      }
    }
  }, origin);
  return changed;
}

/** A random id for this copy's own edits, as Yjs makes them. */
function freshDoc(): Y.Doc {
  return new Y.Doc({ gc: true });
}

/**
 * The client id a note's text is given when it is first made a document from
 * a body that has none: the same on every device for the same saved version,
 * so every device that does this makes the very same document, and what each
 * then writes in it fits everyone else's.
 */
export function startingClient(noteId: string, version: number): number {
  const h = sha256(utf8.enc(`nexa-note-start\0${noteId}\0${version}`));
  // never 0, which is no different from any other id but reads like a placeholder
  return (((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0) || 1;
}

/** A document holding exactly `start`, made the same way on every device (see startingClient). */
export function startingDoc(noteId: string, version: number, start: NoteDoc): Y.Doc {
  const seed = freshDoc();
  seed.clientID = startingClient(noteId, version);
  seed.transact(() => {
    if (start.title) seed.getText(TITLE).insert(0, start.title);
    if (start.md) seed.getText(MD).insert(0, start.md);
    const map = seed.getMap(FILES);
    for (const id of Object.keys(start.files).sort()) map.set(id, start.files[id]);
  });
  const doc = freshDoc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
  seed.destroy();
  return doc;
}

/** Whether a body opened from a note carries its document. */
export function hasDoc(raw: unknown): raw is BodyV2 {
  return typeof raw === "object" && raw !== null && (raw as Record<string, unknown>)["v"] === 2 && typeof (raw as Record<string, unknown>)["y"] === "string";
}

/** The document a saved body holds, or the one made from its plain text when it holds none. */
export function docFromBody(noteId: string, version: number, title: string, raw: unknown): Y.Doc {
  if (hasDoc(raw)) {
    const doc = freshDoc();
    try {
      Y.applyUpdate(doc, b64.dec(raw.y));
      return doc;
    } catch {
      // a document that cannot be read is no document: the plain text stands in
      doc.destroy();
    }
  }
  const body = readBody(raw);
  return startingDoc(noteId, version, { title, md: body.md, files: body.files });
}

/** Takes in a saved body's document beside what this copy has; what both hold is held once. */
export function mergeBody(doc: Y.Doc, raw: unknown, origin: unknown): boolean {
  if (!hasDoc(raw)) return false;
  try {
    Y.applyUpdate(doc, b64.dec(raw.y), origin);
    return true;
  } catch {
    return false;
  }
}

/** The body to save: the whole document, and the note as plain values. */
export function bodyOf(doc: Y.Doc, note: { md: string; files: Record<string, AttachmentMeta> }): BodyV2 {
  return { v: 2, y: b64.enc(Y.encodeStateAsUpdate(doc)), md: note.md, files: note.files };
}

export { Y };
