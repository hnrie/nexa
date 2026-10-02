/**
 * Notes: how a note is sealed.
 *
 * A note has a key of its own, 32 random bytes made on the device that
 * creates it. Its head (the title and first lines, for the list) and its body
 * (the note, and what its files are) are each sealed with that key, and the
 * key is sealed to every person the note is shared with, as a conversation's
 * key is. The server holds only what comes out of this file.
 *
 * A share link carries a second key in its fragment, the part of an address
 * that is never sent anywhere. That key opens a copy of the note's key the
 * server keeps beside the link, so holding the whole link is what lets
 * someone in, and the server, which never sees the fragment, cannot read the
 * note through its own link.
 */

import { sha256 } from "@noble/hashes/sha256";
import { IV_LEN, TAG_LEN, gcmDecrypt, gcmEncrypt } from "./aes";
import { b64, concat, randomBytes, utf8 } from "./bytes";
import { DecryptError, open, seal, type Identity } from "./keys";

const KEY_LEN = 32;
const VERSION = "v1";

/** What a sealed part is bound to, so that one cannot be passed off as another. */
export type NotePart = "head" | "body" | "link" | "link-key" | "prev-key" | "cursor" | "update";

const aad = (part: NotePart): Uint8Array => utf8.enc(`nexa-note/v1/${part}`);

/** Base64 as an address can carry it: "-" and "_", and no padding. */
export const b64url = {
  enc(u: Uint8Array): string {
    return b64.enc(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("invalid base64url");
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    return b64.dec(std + "=".repeat((4 - (std.length % 4)) % 4));
  },
};

export function newNoteKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

/** Seals bytes with a key: "v1.<iv>.<ciphertext and tag>", each part base64url. */
async function sealBytes(key: Uint8Array, part: NotePart, data: Uint8Array): Promise<string> {
  if (key.length !== KEY_LEN) throw new Error("a note key is 32 bytes");
  const iv = randomBytes(IV_LEN);
  return `${VERSION}.${b64url.enc(iv)}.${b64url.enc(await gcmEncrypt(key, iv, data, aad(part)))}`;
}

async function openBytes(key: Uint8Array, part: NotePart, sealed: string): Promise<Uint8Array> {
  const pieces = typeof sealed === "string" ? sealed.split(".") : [];
  if (pieces.length !== 3 || pieces[0] !== VERSION) throw new DecryptError("not a sealed note");
  try {
    const iv = b64url.dec(pieces[1]!);
    const ct = b64url.dec(pieces[2]!);
    if (iv.length !== IV_LEN || ct.length < TAG_LEN) throw new Error("short");
    return await gcmDecrypt(key, iv, ct, aad(part));
  } catch {
    // a wrong key, a part passed off as another, and a damaged text all read the same
    throw new DecryptError("the note could not be opened");
  }
}

/** Seals a note's head or body: anything JSON can carry. */
export async function sealNote(key: Uint8Array, part: "head" | "body", value: unknown): Promise<string> {
  return sealBytes(key, part, utf8.enc(JSON.stringify(value)));
}

/** Opens a note's head or body. What comes out is whatever was sealed; the caller checks its shape. */
export async function openNote(key: Uint8Array, part: "head" | "body", sealed: string): Promise<unknown> {
  const bytes = await openBytes(key, part, sealed);
  try {
    return JSON.parse(utf8.dec(bytes)) as unknown;
  } catch {
    throw new DecryptError("the note could not be read");
  }
}

/**
 * One change to a note, as its CRDT says it (lib/notes/ydoc.ts): bytes,
 * sealed like the note, since what changed is what is written.
 */
export async function sealNoteUpdate(key: Uint8Array, update: Uint8Array): Promise<string> {
  return sealBytes(key, "update", update);
}

export async function openNoteUpdate(key: Uint8Array, sealed: string): Promise<Uint8Array> {
  return openBytes(key, "update", sealed);
}

/**
 * Where someone's caret and selection are in a note, for the others with it
 * open. Sealed like the note itself: where a caret sits says something about
 * what is written there.
 */
export async function sealNoteCursor(key: Uint8Array, value: unknown): Promise<string> {
  return sealBytes(key, "cursor", utf8.enc(JSON.stringify(value)));
}

export async function openNoteCursor(key: Uint8Array, sealed: string): Promise<unknown> {
  const bytes = await openBytes(key, "cursor", sealed);
  try {
    return JSON.parse(utf8.dec(bytes)) as unknown;
  } catch {
    throw new DecryptError("the cursor could not be read");
  }
}

/** The note's key for one person: a sealed box to their identity key, as base64url. */
export async function sealNoteKey(recipientPub: Uint8Array, key: Uint8Array): Promise<string> {
  return b64url.enc(await seal(recipientPub, key));
}

/** Opens this account's copy of a note's key. */
export async function openNoteKey(identity: Identity, sealed: string): Promise<Uint8Array> {
  let box: Uint8Array;
  try {
    box = b64url.dec(sealed);
  } catch {
    throw new DecryptError("the note's key is not readable");
  }
  const key = await open(identity.privateKey, identity.publicKey, box);
  if (key.length !== KEY_LEN) throw new DecryptError("the note's key is the wrong size");
  return key;
}

/**
 * The key a note had before, sealed with the one that replaced it. A note
 * gets a new key when someone is taken out of it; its earlier versions stay
 * sealed with the keys of their time, and this is how whoever holds the
 * newest key opens them: each key opens the one before.
 */
export async function wrapPreviousKey(newKey: Uint8Array, oldKey: Uint8Array): Promise<string> {
  return sealBytes(newKey, "prev-key", oldKey);
}

export async function unwrapPreviousKey(newerKey: Uint8Array, wrapped: string): Promise<Uint8Array> {
  const key = await openBytes(newerKey, "prev-key", wrapped);
  if (key.length !== KEY_LEN) throw new DecryptError("the earlier key is the wrong size");
  return key;
}

/**
 * The key a note had at `epoch`, given its key now (at `current`) and its
 * earlier keys as the server keeps them: `wrapped[n]` is the key of epoch n
 * under the key of epoch n + 1.
 */
export async function noteKeyAt(key: Uint8Array, current: number, epoch: number, wrapped: Record<number, string>): Promise<Uint8Array> {
  if (epoch > current || epoch < 0) throw new DecryptError("no such key");
  let k = key;
  for (let e = current - 1; e >= epoch; e--) {
    const w = wrapped[e];
    if (!w) throw new DecryptError("an earlier key is missing");
    k = await unwrapPreviousKey(k, w);
  }
  return k;
}

/** A share link's two secrets: the token the server knows it by, and the key in its fragment. */
export interface NoteLinkSecret {
  token: string;
  key: string;
}

export function newNoteLink(): NoteLinkSecret {
  return { token: b64url.enc(randomBytes(18)), key: b64url.enc(randomBytes(KEY_LEN)) };
}

/** How the server knows a link's token: by this hash of it, in hex. The server computes the same. */
export function noteTokenHash(token: string): string {
  const sum = sha256(utf8.enc("nexa-note-link\u0000" + token));
  return Array.from(sum, (b) => b.toString(16).padStart(2, "0")).join("");
}

function linkKey(secret: NoteLinkSecret): Uint8Array {
  let key: Uint8Array;
  try {
    key = b64url.dec(secret.key);
  } catch {
    throw new DecryptError("the link's key is not readable");
  }
  if (key.length !== KEY_LEN) throw new DecryptError("the link's key is the wrong size");
  return key;
}

/** The note's key under the link's key, for the server to keep beside the link. */
export async function wrapNoteKeyForLink(secret: NoteLinkSecret, noteKey: Uint8Array): Promise<string> {
  // bound to the token, so one link's copy cannot be served for another link
  return sealBytes(linkKey(secret), "link-key", concat(utf8.enc(secret.token + "\u0000"), noteKey));
}

/** Opens the copy of the note's key a link leads to. */
export async function unwrapNoteKeyFromLink(secret: NoteLinkSecret, wrapped: string): Promise<Uint8Array> {
  const bytes = await openBytes(linkKey(secret), "link-key", wrapped);
  const prefix = utf8.enc(secret.token + "\u0000");
  if (bytes.length !== prefix.length + KEY_LEN || !prefix.every((b, i) => bytes[i] === b)) throw new DecryptError("the link does not belong to this note");
  return bytes.slice(prefix.length);
}

/** The link's two secrets under the note's key, so the note's owner can copy the link again from any device. */
export async function sealNoteLink(noteKey: Uint8Array, secret: NoteLinkSecret): Promise<string> {
  return sealBytes(noteKey, "link", utf8.enc(JSON.stringify(secret)));
}

export async function openNoteLink(noteKey: Uint8Array, sealed: string): Promise<NoteLinkSecret> {
  const bytes = await openBytes(noteKey, "link", sealed);
  try {
    const v = JSON.parse(utf8.dec(bytes)) as Partial<NoteLinkSecret>;
    if (typeof v.token === "string" && typeof v.key === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v.token) && /^[A-Za-z0-9_-]{43}$/.test(v.key)) return { token: v.token, key: v.key };
  } catch {
    // falls through
  }
  throw new DecryptError("the link could not be read");
}

/** A share link's path and fragment: "/note/<token>#<key>". */
export function noteLinkPath(secret: NoteLinkSecret): string {
  return `/note/${secret.token}#${secret.key}`;
}

/** Reads a share link (a whole address or its path) back into its two secrets, or null for anything else. */
export function parseNoteLink(link: string, origin?: string): NoteLinkSecret | null {
  let u: URL;
  try {
    u = new URL(link, origin ?? "https://nexa.invalid");
  } catch {
    return null;
  }
  if (origin && u.origin !== new URL(origin).origin) return null;
  const m = /^\/note\/([A-Za-z0-9_-]{16,128})\/?$/.exec(u.pathname);
  const key = u.hash.slice(1);
  if (!m || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { token: m[1]!, key };
}
