/**
 * Safety numbers: a short, readable stand-in for an identity public key.
 *
 * Pinning a key catches a key that *changes*. It cannot catch a key that was
 * wrong the first time this device saw it, because every public key a client
 * holds came from the server. The only cure for that is for two people to
 * compare something out of band — read it down a phone line, hold a screen up,
 * scan a QR code across a table — so there has to be something short enough to
 * read aloud.
 *
 * The derivation deliberately follows Signal's safety numbers, because the
 * reasoning behind theirs applies here unchanged:
 *
 * - **Decimal digits, not words.** A wordlist has to be the same on every
 *   platform and reads badly in the eleven languages this app ships. Digits
 *   are unambiguous over a bad phone line in any of them, and "seven" is
 *   "seven" whether the reader is looking at a Latin or an Arabic keypad.
 * - **Groups of five.** People compare in chunks; a thirty-character run of
 *   digits is where the eye slips.
 * - **Iterated hashing.** Thirty digits is about 99.7 bits, which no one is
 *   brute-forcing. The iteration is for the reader who only checks the first
 *   group or two: grinding an x25519 key whose fingerprint merely *starts* the
 *   same costs 5200 SHA-256 evaluations per attempt instead of one.
 *
 * The exact bytes matter, because every client must print the same digits for
 * the same key or the comparison means nothing. The definition is:
 *
 *     h = SHA-256("evilion-chat/fingerprint/v1" ‖ key)
 *     h = SHA-256(h ‖ key), repeated until 5200 hashes have been taken
 *     digits = for g in 0..5: uint40be(h[5g .. 5g+5]) mod 100000, zero-padded
 *
 * `fingerprint.test.ts` pins those digits with two test vectors. Anyone who
 * has already compared numbers with a contact relies on them staying put, so a
 * change that moves them is a new version of the format, not a fix.
 */

import { sha256 } from "@noble/hashes/sha256";
import { b64, concat, utf8 } from "./bytes";

/** Domain separation, so these digits can never collide with another hash of the same key. */
const PREFIX = utf8.enc("evilion-chat/fingerprint/v1");

/** Total SHA-256 evaluations, Signal's count. */
const ROUNDS = 5200;

const GROUPS = 6;
const GROUP_BYTES = 5;
const GROUP_DIGITS = 5;
const GROUP_MOD = 100000;

/** An x25519 public key is 32 bytes; anything else is not a key we can name. */
const KEY_LEN = 32;

/**
 * Deriving one of these costs a few milliseconds, and the same handful of keys
 * are asked about over and over as a profile card opens and closes. The keys
 * here are public, so nothing secret is being kept alive by the cache.
 */
const cache = new Map<string, string>();
const MAX_CACHED = 256;

/** The five digits a group of five bytes stands for, read big-endian. */
function group(h: Uint8Array, at: number): string {
  // 40 bits is well inside a double's exact integer range, so this needs none
  // of the bit twiddling that would silently truncate at 32.
  const n = (h[at] ?? 0) * 2 ** 32 + ((h[at + 1] ?? 0) * 2 ** 24 + (h[at + 2] ?? 0) * 2 ** 16 + (h[at + 3] ?? 0) * 2 ** 8 + (h[at + 4] ?? 0));
  return String(n % GROUP_MOD).padStart(GROUP_DIGITS, "0");
}

/**
 * The safety number for an identity public key: thirty digits in six groups,
 * such as `61271 82505 00669 17367 22914 44410`.
 *
 * Throws on anything that is not a 32-byte x25519 public key rather than
 * printing digits for it, because a fingerprint nobody can reproduce is worse
 * than none at all.
 */
export function fingerprint(publicKey: Uint8Array): string {
  if (publicKey.length !== KEY_LEN) throw new RangeError("fingerprint: not an identity public key");
  let h = sha256(concat(PREFIX, publicKey));
  for (let i = 1; i < ROUNDS; i++) h = sha256(concat(h, publicKey));
  const out: string[] = [];
  for (let g = 0; g < GROUPS; g++) out.push(group(h, g * GROUP_BYTES));
  return out.join(" ");
}

/**
 * The same thing for a key as the API carries it, base64. Returns null rather
 * than throwing for a missing or malformed key, since callers are drawing a
 * profile card and a blank space is the honest answer there.
 */
export function fingerprintOfB64(publicKeyB64: string | null | undefined): string | null {
  if (!publicKeyB64) return null;
  const hit = cache.get(publicKeyB64);
  if (hit) return hit;
  let out: string;
  try {
    out = fingerprint(b64.dec(publicKeyB64));
  } catch {
    return null;
  }
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(publicKeyB64, out);
  return out;
}
