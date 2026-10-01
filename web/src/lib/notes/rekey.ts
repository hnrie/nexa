import { ApiError } from "@/api/client";
import { notes as notesApi } from "@/api/notes";
import { NOTE_OWNER } from "@/api/types";
import { newNoteKey, openNote, openNoteLink, sealNote, sealNoteKey, sealNoteLink, wrapNoteKeyForLink, wrapPreviousKey } from "@/crypto/notes";
import { useAuth } from "@/stores/auth";
import { sealingKeyOf, useKeys } from "@/stores/keys";
import { noteKeyOf } from "./keys";

/**
 * Giving a note a new key.
 *
 * When someone who held a note's key is no longer in it (taken out, left, an
 * invitation or a share link removed), the server marks the note, and the
 * owner's app does this the next time it sees the mark, whenever that is:
 * a new key, the note sealed again with it, and the key sealed to everyone
 * still in the note, to each invitation still waiting and for each link still
 * there. Whoever left keeps what they could already read and gets nothing
 * written after. The key being replaced is kept, sealed with the new one, so
 * the note's earlier versions can still be opened by the people in it now.
 */

export type RekeyResult = "done" | "not-needed" | "blocked" | "failed";

const running = new Map<string, Promise<RekeyResult>>();
/** When a note's rekey last could not be done, so one that cannot be is not tried on every event. */
const stuck = new Map<string, number>();
const TRY_AGAIN_AFTER = 60_000;

/** Gives the note a new key if it is marked as needing one and this account owns it. */
export function rekeyNote(id: string, opts: { force?: boolean } = {}): Promise<RekeyResult> {
  const going = running.get(id);
  if (going) return going;
  const last = stuck.get(id);
  if (!opts.force && last !== undefined && Date.now() - last < TRY_AGAIN_AFTER) return Promise.resolve("failed");
  const job = run(id)
    .catch((): RekeyResult => "failed")
    .then((res) => {
      if (res === "blocked" || res === "failed") stuck.set(id, Date.now());
      else stuck.delete(id);
      return res;
    })
    .finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

/** Forgets what could not be done, for the next account on this tab. */
export function forgetRekeys(): void {
  stuck.clear();
}

async function run(id: string): Promise<RekeyResult> {
  const identity = useKeys.getState().identity;
  const meId = useAuth.getState().me?.id;
  if (!identity || !meId) return "failed";
  // a save or someone joining in between makes the server refuse; it is put together again from what is there now
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await notesApi.get(id);
    // done meanwhile by another of this account's devices, or not this account's to do
    if (row.role !== NOTE_OWNER || !row.needs_rekey) return "not-needed";
    const oldKey = await noteKeyOf(row);
    const sharing = await notesApi.sharing(id);
    const newKey = newNoteKey();

    const members: { user_id: string; key_sealed: string }[] = [];
    for (const m of sharing.members) {
      const pub = m.user.id === meId ? identity.publicKey : await sealingKeyOf(m.user.id);
      // Their key is not the one this device knows them by, and nobody has
      // accepted the change: nothing is sealed to it. The note waits; the
      // change is already in front of the person (stores/keys.ts).
      if (!pub) return "blocked";
      members.push({ user_id: m.user.id, key_sealed: await sealNoteKey(pub, newKey) });
    }
    // An invitation or a link that cannot be carried over is left out, and
    // the server drops it: it could not open the note any more anyway.
    const invites: { id: string; key_sealed: string }[] = [];
    for (const inv of sharing.invites) {
      const pub = await sealingKeyOf(inv.user.id).catch(() => null);
      if (pub) invites.push({ id: inv.id, key_sealed: await sealNoteKey(pub, newKey) });
    }
    const links: { id: string; key_wrapped: string; link_sealed: string }[] = [];
    for (const l of sharing.links) {
      try {
        const secret = await openNoteLink(oldKey, l.link_sealed);
        links.push({ id: l.id, key_wrapped: await wrapNoteKeyForLink(secret, newKey), link_sealed: await sealNoteLink(newKey, secret) });
      } catch {
        // sealed with a key this device does not have: it stops working
      }
    }

    const [head, body] = await Promise.all([openNote(oldKey, "head", row.head), openNote(oldKey, "body", row.body ?? "")]);
    const [newHead, newBody, prevKey] = await Promise.all([sealNote(newKey, "head", head), sealNote(newKey, "body", body), wrapPreviousKey(newKey, oldKey)]);
    try {
      await notesApi.rekey(id, { head: newHead, body: newBody, base_version: row.version, prev_key: prevKey, members, invites, links });
      return "done";
    } catch (err) {
      if (err instanceof ApiError && (err.code === "note_stale" || err.code === "note_members_changed")) continue;
      throw err;
    }
  }
  return "failed";
}
