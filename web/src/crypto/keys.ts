/**
 * Identity keys, private-key wrapping, and sealed boxes.
 *
 * An identity is a long-lived x25519 key pair. The private half is wrapped with
 * the password-derived encryption key before it is ever handed to the server.
 * Conversation root keys are handed to members as sealed boxes addressed to
 * their identity public key.
 */

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { IV_LEN, TAG_LEN, gcmDecrypt, gcmEncrypt } from "./aes";
import { concat, randomBytes, utf8 } from "./bytes";

export interface Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Thrown whenever a ciphertext fails to authenticate or is malformed. */
export class DecryptError extends Error {
  constructor(message = "decryption failed") {
    super(message);
    this.name = "DecryptError";
  }
}

const KEY_LEN = 32;
const NO_SALT = new Uint8Array(0);
const AAD_PRIVKEY = utf8.enc("privkey/v1");
const INFO_SEAL = utf8.enc("evilion-chat/seal/v1");

export function generateIdentity(): Identity {
  const privateKey = randomBytes(KEY_LEN);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** Wrap an identity private key with the password-derived encryption key. */
export async function wrapPrivateKey(priv: Uint8Array, encKey: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_LEN);
  return concat(iv, await gcmEncrypt(encKey, iv, priv, AAD_PRIVKEY));
}

export async function unwrapPrivateKey(blob: Uint8Array, encKey: Uint8Array): Promise<Uint8Array> {
  if (blob.length < IV_LEN + TAG_LEN) throw new DecryptError("wrapped private key is too short");
  try {
    return await gcmDecrypt(encKey, blob.subarray(0, IV_LEN), blob.subarray(IV_LEN), AAD_PRIVKEY);
  } catch {
    throw new DecryptError("wrapped private key failed to decrypt");
  }
}

function sealKey(ephPub: Uint8Array, recipientPub: Uint8Array, shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, NO_SALT, concat(INFO_SEAL, ephPub, recipientPub), KEY_LEN);
}

/**
 * Seal `data` to `recipientPub` with an ephemeral x25519 key.
 * Layout: ephemeral public key (32) | iv (12) | AES-256-GCM ciphertext and tag.
 */
export async function seal(recipientPub: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const eph = generateIdentity();
  const shared = x25519.getSharedSecret(eph.privateKey, recipientPub);
  const key = sealKey(eph.publicKey, recipientPub, shared);
  const iv = randomBytes(IV_LEN);
  return concat(eph.publicKey, iv, await gcmEncrypt(key, iv, data, eph.publicKey));
}

export async function open(
  recipientPriv: Uint8Array,
  recipientPub: Uint8Array,
  blob: Uint8Array,
): Promise<Uint8Array> {
  if (blob.length < KEY_LEN + IV_LEN + TAG_LEN) throw new DecryptError("sealed box is too short");
  const ephPub = blob.subarray(0, KEY_LEN);
  const iv = blob.subarray(KEY_LEN, KEY_LEN + IV_LEN);
  const ct = blob.subarray(KEY_LEN + IV_LEN);
  try {
    // getSharedSecret itself rejects low-order points, which lands here too.
    const shared = x25519.getSharedSecret(recipientPriv, ephPub);
    return await gcmDecrypt(sealKey(ephPub, recipientPub, shared), iv, ct, ephPub);
  } catch {
    throw new DecryptError("sealed box failed to decrypt");
  }
}

/** A conversation root key sealed to a member's identity key. */
export const wrapGrant: (recipientPub: Uint8Array, root: Uint8Array) => Promise<Uint8Array> = seal;

export const unwrapGrant: (
  priv: Uint8Array,
  pub: Uint8Array,
  wrapped: Uint8Array,
) => Promise<Uint8Array> = open;
