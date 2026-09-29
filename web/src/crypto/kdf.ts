/**
 * Password and recovery-key derivation.
 *
 * The password never leaves the device: argon2id stretches it into a master
 * key, and HKDF splits that into an authentication key (sent to the server as
 * proof of knowledge) and an encryption key (used to wrap the identity key).
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
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

/**
 * The weakest and the heaviest argon2id parameters this client will stretch a
 * password with.
 *
 * Registration picks DEFAULT_KDF, but every later sign-in asks the *server*
 * which parameters to use, because the account may have been registered with
 * others. A server that answers `{m: 8, t: 1}` makes the stretching free, and
 * since the client then hands over `HKDF(argon2id(password, …), auth)` as proof
 * of knowledge, the server can grind that back to the plaintext password in
 * seconds — and with the password it unwraps the identity private key it
 * already stores. So the answer is checked before it is used.
 *
 * The numbers are the server's own, from `validKDF` in
 * `internal/api/auth_handlers.go`, which is what it accepts when a client
 * *submits* parameters. Mirroring them exactly means no account that the server
 * ever allowed to register can be refused by its own client: every account on
 * every account on Nexa is at DEFAULT_KDF, which is comfortably inside this range.
 *
 * The ceiling matters as much as the floor in practice. Without it a hostile
 * server wedges a device by asking for a gibibyte of memory and twenty passes,
 * which on a phone is indistinguishable from the app hanging.
 */
export const KDF_FLOOR: Readonly<KdfParams> = { m: 32768, t: 2, p: 1, v: 1 };
export const KDF_CEILING: Readonly<Omit<KdfParams, "v">> = { m: 1 << 20, t: 20, p: 4 };

/**
 * Thrown instead of deriving anything when the parameters a server handed over
 * are outside the range above. It is a distinct type so the screens that ask
 * for a password can say what happened rather than blaming the password.
 */
export class WeakKdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakKdfError";
  }
}

/**
 * Whether parameters are ones this client is willing to use. Anything that is
 * not a whole number in range fails, including the shapes a hostile or broken
 * server might send instead of numbers.
 */
export function kdfParamsAcceptable(p: { m?: unknown; t?: unknown; p?: unknown; v?: unknown }): boolean {
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
  if (!whole(p.m) || !whole(p.t) || !whole(p.p)) return false;
  // `v` is the params version. Registration has only ever written 1, and a
  // version this build does not know is not something to guess at.
  if (p.v !== undefined && p.v !== 1) return false;
  return p.m >= KDF_FLOOR.m && p.m <= KDF_CEILING.m && p.t >= KDF_FLOOR.t && p.t <= KDF_CEILING.t && p.p >= KDF_FLOOR.p && p.p <= KDF_CEILING.p;
}

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

/**
 * Stretch a password into a 32-byte master key with argon2id.
 *
 * The parameter check is here, at the one place every argon2id derivation in
 * the client passes through, rather than only where the parameters arrive:
 * a path added later that forgets to check is then still safe.
 */
export async function deriveMaster(password: string, salt: Uint8Array, p: KdfParams): Promise<Uint8Array> {
  if (!kdfParamsAcceptable(p)) throw new WeakKdfError(`argon2id parameters outside the accepted range: m=${p.m} t=${p.t} p=${p.p} v=${p.v}`);
  // Loaded when a password is first stretched: every visitor to the front page
  // or an invite used to download it with the app.
  const { argon2id } = await import("hash-wasm");
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
