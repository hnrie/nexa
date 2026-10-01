import { notes as notesApi } from "@/api/notes";
import type { NoteLinkRow, NoteRole, PublicUser } from "@/api/types";
import { DecryptError } from "@/crypto/keys";
import { newNoteKey, newNoteLink, noteLinkPath, noteTokenHash, openNoteLink, sealNote, sealNoteKey, sealNoteLink, wrapNoteKeyForLink, type NoteLinkSecret } from "@/crypto/notes";
import { guarded } from "@/lib/captcha";
import { ReadableError } from "@/lib/readableError";
import { sealingKeyOf, useKeys } from "@/stores/keys";
import { refreshNote, useNotes, type NoteInviteItem, type NoteItem } from "@/stores/notes";
import { heldNoteKey } from "./keys";
import type { OpenedNoteLink } from "./linkPreview";
import { headOf, type NoteDoc } from "./model";

import { t } from "@/i18n";

/**
 * Making notes and sharing them. Everything that leaves this file for the
 * server is sealed: a new note's head and body with a key made here, and that
 * key to each person it is shared with, with their identity key as this
 * device knows it.
 */

function identity() {
  const id = useKeys.getState().identity;
  if (!id) throw new DecryptError("this device's keys are not open");
  return id;
}

/** The note's key, opened: the one in memory, or fetched with the note. */
async function keyFor(noteId: string): Promise<Uint8Array> {
  return heldNoteKey(noteId)?.key ?? (await refreshNote(noteId)).key;
}

/** Makes a note, empty unless told what it says, and puts it in the list. */
export async function createNote(start: Partial<NoteDoc> = {}): Promise<NoteItem> {
  const me = identity();
  const doc: NoteDoc = { title: "", md: "", files: {}, ...start };
  const key = newNoteKey();
  const [head, body, keySealed] = await Promise.all([sealNote(key, "head", headOf(doc)), sealNote(key, "body", { md: doc.md, files: doc.files }), sealNoteKey(me.publicKey, key)]);
  const row = await notesApi.create(head, body, keySealed);
  return useNotes.getState().put(row);
}

/**
 * Asks someone into a note: the note's key is sealed to them and waits with
 * the invitation until they answer. Their key is the one this device knows
 * them by; one that changed and was not accepted is not sealed to.
 */
export async function inviteToNote(noteId: string, user: PublicUser, role: NoteRole): Promise<void> {
  const key = await keyFor(noteId);
  const pub = await sealingKeyOf(user.id);
  if (!pub) throw new ReadableError(t("notes.share.keyChanged", { name: user.display_name || user.username }));
  const keySealed = await sealNoteKey(pub, key);
  await guarded("note_invite", (captcha) => notesApi.invite(noteId, user.id, role, keySealed, captcha));
}

export async function acceptNoteInvite(invite: NoteInviteItem): Promise<NoteItem> {
  const row = await notesApi.acceptInvite(invite.id);
  useNotes.getState().dropInvite(invite.id);
  return useNotes.getState().put(row);
}

export async function declineNoteInvite(invite: NoteInviteItem): Promise<void> {
  await notesApi.declineInvite(invite.id);
  useNotes.getState().dropInvite(invite.id);
}

/** A share link's whole address, as it is given to someone. */
export function noteLinkUrl(secret: NoteLinkSecret): string {
  return `${window.location.origin}${noteLinkPath(secret)}`;
}

/**
 * Makes a share link. The link's token and key are made here; the server is
 * given the token's hash and the note's key under the link's key, and never
 * the part of the link after the #.
 */
export async function createNoteLink(noteId: string, role: NoteRole): Promise<{ row: NoteLinkRow; url: string }> {
  const key = await keyFor(noteId);
  const secret = newNoteLink();
  const [keyWrapped, linkSealed] = await Promise.all([wrapNoteKeyForLink(secret, key), sealNoteLink(key, secret)]);
  const row = await notesApi.createLink(noteId, { token_hash: noteTokenHash(secret.token), role, key_wrapped: keyWrapped, link_sealed: linkSealed });
  return { row, url: noteLinkUrl(secret) };
}

/** A link's address, read back from what the server keeps of it; null when this device cannot open it. */
export async function noteLinkAddress(noteId: string, row: NoteLinkRow): Promise<string | null> {
  try {
    return noteLinkUrl(await openNoteLink(await keyFor(noteId), row.link_sealed));
  } catch {
    return null;
  }
}

/** Joins the note a link leads to: the note's key, sealed to this account, makes it a member. */
export async function joinNoteLink(secret: NoteLinkSecret, opened: OpenedNoteLink): Promise<NoteItem> {
  const keySealed = await sealNoteKey(identity().publicKey, opened.key);
  const row = await notesApi.joinLink(secret.token, keySealed);
  return useNotes.getState().put(row);
}

/** Deletes a note this account owns, or leaves one it was shared. */
export async function removeNote(note: NoteItem): Promise<void> {
  if (note.role === 3) await notesApi.remove(note.id);
  else await notesApi.removeMember(note.id, "@me");
  useNotes.getState().drop(note.id);
}
