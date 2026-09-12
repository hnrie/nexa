/**
 * Password and recovery-key derivation.
 *
 * The password never leaves the device: argon2id stretches it into a master
 * key, and HKDF splits that into an authentication key (sent to the server as
 * proof of knowledge) and an encryption key (used to wrap the identity key).
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { argon2id } from "hash-wasm";
import { randomBytes, utf8 } from "./bytes";

export interface KdfParams {
  /** Memory cost in KiB. */
  m: number;
  /** Iterations (time cost). */
  t: number;
  /** Parallelism (lanes). */
  p: number;
  /** Params version, so a future migration can be detected. */
  v: 1;
}

export const DEFAULT_KDF: KdfParams = { m: 65536, t: 3, p: 1, v: 1 };

const KEY_LEN = 32;
const NO_SALT = new Uint8Array(0);

const INFO_AUTH = utf8.enc("evilion-chat/auth/v1");
const INFO_ENC = utf8.enc("evilion-chat/enc/v1");
const INFO_SETTINGS = utf8.enc("evilion-chat/settings/v1");
const INFO_RECOVERY_AUTH = utf8.enc("evilion-chat/recovery-auth/v1");
const INFO_RECOVERY_ENC = utf8.enc("evilion-chat/recovery-enc/v1");

const RECOVERY_BYTES = 32;
const RECOVERY_GROUPS = 8;
const RECOVERY_GROUP_LEN = 8;
const RECOVERY_HEX_LEN = RECOVERY_BYTES * 2;

function expand(ikm: Uint8Array, info: Uint8Array): Uint8Array {
  return hkdf(sha256, ikm, NO_SALT, info, KEY_LEN);
}

/** Stretch a password into a 32-byte master key with argon2id. */
export async function deriveMaster(password: string, salt: Uint8Array, p: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: password.normalize("NFKC"),
    salt,
    iterations: p.t,
    parallelism: p.p,
    memorySize: p.m,
    hashLength: KEY_LEN,
    outputType: "binary",
  });
}

export function deriveAuthKey(master: Uint8Array): Uint8Array {
  return expand(master, INFO_AUTH);
}

export function deriveEncKey(master: Uint8Array): Uint8Array {
  return expand(master, INFO_ENC);
}

/** Encrypts user settings; bound to the identity key so it survives a password change. */
export function deriveSettingsKey(identityPrivateKey: Uint8Array): Uint8Array {
  return expand(identityPrivateKey, INFO_SETTINGS);
}

export function newRecoveryKey(): { bytes: Uint8Array; display: string } {
  const bytes = randomBytes(RECOVERY_BYTES);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  hex = hex.toUpperCase();

  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_GROUPS; i++) {
    groups.push(hex.slice(i * RECOVERY_GROUP_LEN, (i + 1) * RECOVERY_GROUP_LEN));
  }
  return { bytes, display: groups.join("-") };
}

/** Parse a displayed recovery key. Dashes, whitespace and case are all ignored. */
export function recoveryKeyToBytes(display: string): Uint8Array {
  const hex = display.replace(/[\s-]/g, "");
  if (hex.length !== RECOVERY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("invalid recovery key");
  }
  const out = new Uint8Array(RECOVERY_BYTES);
  for (let i = 0; i < RECOVERY_BYTES; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function recoveryToKeys(bytes: Uint8Array): { authKey: Uint8Array; encKey: Uint8Array } {
  return {
    authKey: expand(bytes, INFO_RECOVERY_AUTH),
    encKey: expand(bytes, INFO_RECOVERY_ENC),
  };
}
