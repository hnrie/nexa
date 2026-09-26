import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * A plugin's fingerprint: SHA-256 of its code as UTF-8, in hex. The hash is
 * what a plugin is pinned to when it is approved; nothing whose hash differs
 * is ever run for it without asking again.
 */
export function codeHash(code: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(code)));
}

/** The start of a fingerprint, enough to tell two apart by eye. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
