/**
 * A bot's identity, wrapped under its token.
 *
 * The browser that creates a bot makes its x25519 identity and its token. The
 * server keeps the public key, the private key wrapped under a key derived
 * from the token, an escrow copy sealed to the owner, and the token's SHA-256,
 * but never the token itself. When the bot connects with its token, the server
 * unwraps the identity and acts for the bot (internal/e2ee/botidentity.go is
 * the same scheme in Go). A token reset opens the escrow in the owner's browser
 * and wraps the same identity under a new token, so the conversation keys the
 * bot was granted keep working. docs/bots/crypto.md describes the scheme.
 *
 * Not re-exported from index.ts: only the Developer Portal needs it.
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { IV_LEN, TAG_LEN, gcmDecrypt, gcmEncrypt } from "./aes";
import { b64, concat, equal, randomBytes, utf8 } from "./bytes";
import { DecryptError, type Identity, generateIdentity, open, publicKeyOf, seal } from "./keys";

/** How many random bytes a new bot token carries. */
export const BOT_TOKEN_BYTES = 32;

const KEY_LEN = 32;
/** 43 characters is 32 bytes in unpadded base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43,256}$/;
const WRAP_SALT = utf8.enc("nexa/bot-identity/v1");
const WRAP_INFO = utf8.enc("nexa/bot-identity/v1/wrap");
const WRAP_VERSION = 1;
const WRAPPED_LEN = 1 + IV_LEN + KEY_LEN + TAG_LEN;
/** Keeps an escrow and a conversation grant (a bare 32-byte root) from being taken for one another. */
const ESCROW_LABEL = utf8.enc("nexa/bot-escrow/v1");

/** A fresh bot token: 32 random bytes in URL-safe base64 without padding. */
export function newBotToken(): string {
  return b64.enc(randomBytes(BOT_TOKEN_BYTES)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether a string has the shape of a bot token (not whether any bot has it). */
export function isBotToken(token: string): boolean {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** SHA-256 of the token's characters: all the server keeps of a token. */
export function botTokenHash(token: string): Uint8Array {
  return sha256(utf8.enc(token));
}

/** The token carries 256 random bits, so HKDF is enough; no password stretching. */
function tokenKey(token: string): Uint8Array {
  if (!isBotToken(token)) throw new Error("not a bot token");
  return hkdf(sha256, utf8.enc(token), WRAP_SALT, WRAP_INFO, KEY_LEN);
}

function checkIdentity(id: Identity): void {
  if (id.privateKey.length !== KEY_LEN || !equal(publicKeyOf(id.privateKey), id.publicKey)) {
    throw new Error("the private key is not the public key's");
  }
}

/**
 * Wrap a bot's private key under its token.
 * Layout: version 0x01 | iv (12) | AES-256-GCM of the private key, with the
 * public key as additional data; 61 bytes.
 */
export async function wrapBotIdentity(id: Identity, token: string): Promise<Uint8Array> {
  checkIdentity(id);
  const key = tokenKey(token);
  const iv = randomBytes(IV_LEN);
  return concat(Uint8Array.of(WRAP_VERSION), iv, await gcmEncrypt(key, iv, id.privateKey, id.publicKey));
}

/** Open a wrapped bot identity with the token, and check it is the key pair of `publicKey`. */
export async function unwrapBotIdentity(wrapped: Uint8Array, token: string, publicKey: Uint8Array): Promise<Identity> {
  if (wrapped.length !== WRAPPED_LEN || wrapped[0] !== WRAP_VERSION || publicKey.length !== KEY_LEN) {
    throw new DecryptError("wrapped bot identity is malformed");
  }
  if (!isBotToken(token)) throw new DecryptError("not a bot token");
  let privateKey: Uint8Array;
  try {
    privateKey = await gcmDecrypt(tokenKey(token), wrapped.subarray(1, 1 + IV_LEN), wrapped.subarray(1 + IV_LEN), publicKey);
  } catch {
    throw new DecryptError("wrapped bot identity failed to decrypt");
  }
  if (!equal(publicKeyOf(privateKey), publicKey)) throw new DecryptError("bot identity does not match its public key");
  return { publicKey: publicKey.slice(), privateKey };
}

/**
 * Seal a copy of a bot's identity to its owner, so a token reset can wrap the
 * same identity again. The sealed box holds "nexa/bot-escrow/v1" | public key | private key.
 */
export async function sealBotEscrow(ownerPub: Uint8Array, id: Identity): Promise<Uint8Array> {
  checkIdentity(id);
  return seal(ownerPub, concat(ESCROW_LABEL, id.publicKey, id.privateKey));
}

/** Open an escrow with the owner's key pair, and check it holds the identity of `botPub`. */
export async function openBotEscrow(
  ownerPriv: Uint8Array,
  ownerPub: Uint8Array,
  escrow: Uint8Array,
  botPub: Uint8Array,
): Promise<Identity> {
  const plain = await open(ownerPriv, ownerPub, escrow);
  const n = ESCROW_LABEL.length;
  if (plain.length !== n + 2 * KEY_LEN || !equal(plain.subarray(0, n), ESCROW_LABEL)) {
    throw new DecryptError("not a bot identity escrow");
  }
  const publicKey = plain.slice(n, n + KEY_LEN);
  const privateKey = plain.slice(n + KEY_LEN);
  plain.fill(0);
  if (!equal(publicKeyOf(privateKey), publicKey) || !equal(publicKey, botPub)) {
    throw new DecryptError("escrow does not hold this bot's identity");
  }
  return { publicKey, privateKey };
}

export interface NewBotIdentity {
  /** Shown to the developer once. It never goes to the server. */
  token: string;
  /** What the server keeps to recognise the token. */
  tokenHash: Uint8Array;
  identity: Identity;
  /** The private key wrapped under the token. */
  wrapped: Uint8Array;
  /** The identity sealed to the owner, for token resets. */
  escrow: Uint8Array;
}

/** A new bot's identity and token, as the browser creating the bot makes them. */
export async function createBotIdentity(ownerPub: Uint8Array): Promise<NewBotIdentity> {
  const identity = generateIdentity();
  const token = newBotToken();
  const wrapped = await wrapBotIdentity(identity, token);
  const escrow = await sealBotEscrow(ownerPub, identity);
  return { token, tokenHash: botTokenHash(token), identity, wrapped, escrow };
}

/**
 * A token reset: open the escrow in the owner's browser and wrap the same
 * identity under a new token. The escrow itself stays as it is.
 */
export async function rewrapBotIdentity(
  ownerPriv: Uint8Array,
  ownerPub: Uint8Array,
  escrow: Uint8Array,
  botPub: Uint8Array,
): Promise<{ token: string; tokenHash: Uint8Array; wrapped: Uint8Array }> {
  const identity = await openBotEscrow(ownerPriv, ownerPub, escrow, botPub);
  const token = newBotToken();
  try {
    return { token, tokenHash: botTokenHash(token), wrapped: await wrapBotIdentity(identity, token) };
  } finally {
    identity.privateKey.fill(0);
  }
}
