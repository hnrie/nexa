/**
 * Passcode lock for this device.
 *
 * Turning it on wraps the identity private key with a key stretched from the
 * passcode and deletes the plaintext copy from the browser's key store. So
 * locking only has to forget what is held in memory: nothing left on disk can
 * be read again without the passcode. Ten wrong tries throw the wrapped copy
 * away, which costs nothing permanent because the account password can always
 * fetch the key back from the server.
 */

import { b64, randomBytes } from "@/crypto/bytes";
import { deriveEncKey, deriveMaster, type KdfParams } from "@/crypto/kdf";
import { unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { storage } from "./storage";

/** Heavier than the login KDF: a four-digit passcode needs the help. */
export const LOCK_KDF: KdfParams = { m: 65536, t: 6, p: 1, v: 1 };
export const MAX_FAILURES = 10;
export const MIN_PASSCODE = 4;

/** Idle time before the app locks itself, in milliseconds. 0 means never. */
export const AUTO_LOCK_CHOICES: { label: string; ms: number }[] = [
  { label: "Never", ms: 0 },
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
];

/** How long a background window waits before locking. */
export const BLUR_DELAY_CHOICES: { label: string; ms: number }[] = [
  { label: "Immediately", ms: 0 },
  { label: "After 30 seconds", ms: 30_000 },
  { label: "After 5 minutes", ms: 5 * 60_000 },
];

export interface LockConfig {
  v: 1;
  /** base64 argon2 salt. */
  salt: string;
  params: KdfParams;
  /** base64 identity private key, wrapped with the passcode key. */
  wrapped: string;
  /** base64 identity public key, so unlocking can rebuild the pair. */
  pub: string;
  /** Idle milliseconds before locking; 0 never locks on idle. */
  autoLockMs: number;
  lockOnBlur: boolean;
  blurDelayMs: number;
  /** Consecutive wrong passcodes. */
  failures: number;
}

export const DEFAULT_LOCK = { autoLockMs: 5 * 60_000, lockOnBlur: false, blurDelayMs: 0 };

/** Thrown for a wrong passcode; `left` is how many tries remain. */
export class WrongPasscode extends Error {
  readonly left: number;
  constructor(left: number) {
    super(left > 0 ? `Wrong passcode. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong passcodes.");
    this.name = "WrongPasscode";
    this.left = left;
  }
}

function keyFor(userId: string): string {
  return `ec.lock.${userId}`;
}

function isConfig(v: unknown): v is LockConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return c["v"] === 1 && typeof c["salt"] === "string" && typeof c["wrapped"] === "string" && typeof c["pub"] === "string" && typeof c["params"] === "object";
}

/** Reads this device's lock record, or null when there is no passcode. */
export function loadLock(userId: string): LockConfig | null {
  const raw = storage.get(keyFor(userId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isConfig(parsed)) return null;
    return {
      ...parsed,
      autoLockMs: typeof parsed.autoLockMs === "number" ? parsed.autoLockMs : DEFAULT_LOCK.autoLockMs,
      lockOnBlur: !!parsed.lockOnBlur,
      blurDelayMs: typeof parsed.blurDelayMs === "number" ? parsed.blurDelayMs : 0,
      failures: typeof parsed.failures === "number" ? parsed.failures : 0,
    };
  } catch {
    return null;
  }
}

export function saveLock(userId: string, cfg: LockConfig): void {
  storage.set(keyFor(userId), JSON.stringify(cfg));
}

export function clearLock(userId: string): void {
  storage.remove(keyFor(userId));
}

export function hasLock(userId: string | undefined | null): boolean {
  return !!userId && loadLock(userId) !== null;
}

/** Updates the timing options without touching the wrapped key. */
export function patchLock(userId: string, patch: Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">>): LockConfig | null {
  const cfg = loadLock(userId);
  if (!cfg) return null;
  const next = { ...cfg, ...patch };
  saveLock(userId, next);
  return next;
}

async function passcodeKey(passcode: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return deriveEncKey(await deriveMaster(passcode, salt, params));
}

/** Returns why a passcode is unacceptable, or null when it is fine. */
export function passcodeProblem(passcode: string): string | null {
  if (passcode.length < MIN_PASSCODE) return `Use at least ${MIN_PASSCODE} characters.`;
  if (passcode.length > 128) return "That is too long.";
  if (/^(.)\1*$/.test(passcode)) return "Pick something less guessable than one repeated character.";
  return null;
}

export type LockOptions = Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">> & {
  /** Stretching cost. Only tests pass this; everything else wants LOCK_KDF. */
  kdf?: KdfParams;
};

/** Turns the lock on: wraps the identity with the passcode and stores it. */
export async function enableLock(userId: string, identity: Identity, passcode: string, opts?: LockOptions): Promise<LockConfig> {
  const problem = passcodeProblem(passcode);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const params = opts?.kdf ?? LOCK_KDF;
  const key = await passcodeKey(passcode, salt, params);
  const previous = loadLock(userId);
  const cfg: LockConfig = {
    v: 1,
    salt: b64.enc(salt),
    params,
    wrapped: b64.enc(await wrapPrivateKey(identity.privateKey, key)),
    pub: b64.enc(identity.publicKey),
    autoLockMs: opts?.autoLockMs ?? previous?.autoLockMs ?? DEFAULT_LOCK.autoLockMs,
    lockOnBlur: opts?.lockOnBlur ?? previous?.lockOnBlur ?? DEFAULT_LOCK.lockOnBlur,
    blurDelayMs: opts?.blurDelayMs ?? previous?.blurDelayMs ?? DEFAULT_LOCK.blurDelayMs,
    failures: 0,
  };
  saveLock(userId, cfg);
  return cfg;
}

/**
 * Rebuilds the identity from a passcode. A wrong one counts against the
 * allowance and, once it runs out, deletes the wrapped key so nobody can keep
 * guessing offline; the account password still gets the owner back in.
 */
export async function unlockIdentity(userId: string, passcode: string): Promise<Identity> {
  const cfg = loadLock(userId);
  if (!cfg) throw new Error("This device has no passcode.");
  const key = await passcodeKey(passcode, b64.dec(cfg.salt), cfg.params);
  try {
    const privateKey = await unwrapPrivateKey(b64.dec(cfg.wrapped), key);
    if (cfg.failures !== 0) saveLock(userId, { ...cfg, failures: 0 });
    return { privateKey, publicKey: b64.dec(cfg.pub) };
  } catch {
    const failures = cfg.failures + 1;
    const left = MAX_FAILURES - failures;
    if (left <= 0) clearLock(userId);
    else saveLock(userId, { ...cfg, failures });
    throw new WrongPasscode(Math.max(0, left));
  }
}

/** Tries remaining before the wrapped key is thrown away. */
export function triesLeft(userId: string): number {
  const cfg = loadLock(userId);
  return cfg ? Math.max(0, MAX_FAILURES - cfg.failures) : MAX_FAILURES;
}
