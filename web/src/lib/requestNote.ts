/**
 * The note a friend request can carry: a line or two from whoever sent it
 * ("Hi, it's Sam from the climbing gym").
 *
 * It is sealed on the sender's device to the recipient's identity key with the
 * same sealed box conversation keys travel in (crypto/keys.ts), so the server
 * keeps only ciphertext, on the recipient's side of the request, and only the
 * recipient can open it. Which key it is sealed to is not decided here: the
 * sender takes it from sealingKeyOf (stores/keys.ts), the road every
 * conversation grant takes, pin check included.
 */
import { b64, utf8 } from "@/crypto/bytes";
import { open, seal, type Identity } from "@/crypto/keys";

/** The most a note says, in UTF-16 code units: what the field's maxLength counts. */
export const REQUEST_NOTE_MAX = 200;

/** The note as it is sent: trimmed, and no longer than the field allows. Empty means there is none. */
export function cleanRequestNote(text: string): string {
  const note = text.trim();
  if (note.length <= REQUEST_NOTE_MAX) return note;
  let end = REQUEST_NOTE_MAX;
  // never half of an emoji
  const last = note.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return note.slice(0, end).trimEnd();
}

/** Seals a note to the recipient's identity key, as the base64 the server keeps. */
export async function sealRequestNote(recipientPub: Uint8Array, note: string): Promise<string> {
  return b64.enc(await seal(recipientPub, utf8.enc(note)));
}

/** Refuses bytes that are not UTF-8 rather than showing replacement marks. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Opens a note sent to this account with its own identity key. Null when it
 * does not open or is not text: a note is extra, and one that cannot be read
 * is simply not shown.
 */
export async function openRequestNote(identity: Identity, sealedB64: string): Promise<string | null> {
  try {
    const text = strictUtf8.decode(await open(identity.privateKey, identity.publicKey, b64.dec(sealedB64))).trim();
    return text || null;
  } catch {
    return null;
  }
}
