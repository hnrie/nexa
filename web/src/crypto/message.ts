/**
 * Message envelopes.
 *
 * The server only ever sees an `Envelope`: a conversation id, an epoch, and an
 * opaque AES-256-GCM ciphertext. The channel and author are bound into the
 * additional authenticated data, so a ciphertext cannot be replayed into
 * another channel or attributed to another author.
 */

import { IV_LEN, gcmDecrypt, gcmEncrypt } from "./aes";
import { b64, randomBytes, utf8 } from "./bytes";
import { DecryptError } from "./keys";

export interface Envelope {
  v: 1;
  conv: string;
  epoch: number;
  /** base64 of the 12-byte GCM nonce. */
  iv: string;
  /** base64 of the ciphertext and tag. */
  ct: string;
}

export interface Aad {
  conv: string;
  epoch: number;
  channelId: string;
  authorId: string;
}

export interface AttachmentMeta {
  blob_id: string;
  name: string;
  type: string;
  size: number;
  w?: number;
  h?: number;
  /** base64 of the per-file AES key. */
  key: string;
  spoiler?: boolean;
  duration?: number;
}

export interface MessagePayload {
  t?: string;
  att?: AttachmentMeta[];
  /** A sticker reference: enough to render it without owning the pack. */
  sticker?: { id: string; blob?: string; name?: string; w?: number; h?: number; animated?: boolean };
  embeds?: unknown[];
  flags?: number;
}

export function aadBytes(a: Aad): Uint8Array {
  return utf8.enc(`${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}`);
}

export async function encryptMessage(
  chanKey: Uint8Array,
  aad: Aad,
  payload: MessagePayload,
): Promise<Envelope> {
  const iv = randomBytes(IV_LEN);
  const ct = await gcmEncrypt(chanKey, iv, utf8.enc(JSON.stringify(payload)), aadBytes(aad));
  return { v: 1, conv: aad.conv, epoch: aad.epoch, iv: b64.enc(iv), ct: b64.enc(ct) };
}

export async function decryptMessage(
  chanKey: Uint8Array,
  env: Envelope,
  aad: Aad,
): Promise<MessagePayload> {
  if (env.v !== 1) throw new DecryptError("unsupported envelope version");

  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = b64.dec(env.iv);
    ct = b64.dec(env.ct);
  } catch {
    throw new DecryptError("malformed envelope");
  }
  if (iv.length !== IV_LEN) throw new DecryptError("malformed envelope");

  let plaintext: Uint8Array;
  try {
    plaintext = await gcmDecrypt(chanKey, iv, ct, aadBytes(aad));
  } catch {
    throw new DecryptError("message failed to decrypt");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.dec(plaintext));
  } catch {
    throw new DecryptError("malformed message payload");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DecryptError("malformed message payload");
  }
  return parsed as MessagePayload;
}

export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e["v"] === 1 &&
    typeof e["conv"] === "string" &&
    typeof e["epoch"] === "number" &&
    Number.isInteger(e["epoch"]) &&
    typeof e["iv"] === "string" &&
    typeof e["ct"] === "string"
  );
}
