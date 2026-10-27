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

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { b64, equal, randomBytes, utf8 } from "@/crypto/bytes";
import { deriveEncKey, deriveMaster, type KdfParams } from "@/crypto/kdf";
import type { AppLockPolicy } from "@/stores/settings";
import { unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { ReadableError } from "./readableError";
import { storage } from "./storage";

import { t } from "@/i18n";
/** Heavier than the login KDF: a passcode of digits needs the help. */
export const LOCK_KDF: KdfParams = { m: 65536, t: 6, p: 1, v: 1 };
export const MAX_FAILURES = 10;
export const MIN_PASSCODE = 4;
/**
 * A passcode of digits alone needs more of them. The try counter lives next
 * to the wrapped key, so a copy of this browser's storage can be guessed at
 * offline with no counter at all: four digits fall in minutes on a laptop,
 * six take days. Six is also what phones settled on. Passcodes made before
 * this keep working; only new ones are held to it.
 */
export const MIN_NUMERIC_PASSCODE = 6;

/** Idle time before the app locks itself, in milliseconds. 0 means never. */
export function autoLockChoices(): { label: string; ms: number }[] {
  return [
  { label: t("modals.groupInvite.never"), ms: 0 },
  { label: t("appLock.1Minute"), ms: 60_000 },
  { label: t("server.memberAction.5Minutes"), ms: 5 * 60_000 },
  { label: t("appLock.15Minutes"), ms: 15 * 60_000 },
  { label: t("modals.customStatus.1Hour"), ms: 60 * 60_000 },
];
}

/** How long a background window waits before locking. */
export function blurDelayChoices(): { label: string; ms: number }[] {
  return [
  { label: t("appLock.immediately"), ms: 0 },
  { label: t("appLock.after30Seconds"), ms: 30_000 },
  { label: t("appLock.after5Minutes"), ms: 5 * 60_000 },
];
}

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
  /**
   * Whether the passcode is all digits, so the lock screen can offer a number
   * pad. Records made before this was kept leave it out until the next unlock.
   */
  numeric?: boolean;
}

export const DEFAULT_LOCK = { autoLockMs: 5 * 60_000, lockOnBlur: false, blurDelayMs: 0 };

/** Thrown for a wrong passcode; `left` is how many tries remain. */
export class WrongPasscode extends Error {
  /** Tries before the wrapped key is destroyed, or null where there is none to destroy and nothing is counted. */
  readonly left: number | null;
  constructor(left: number | null) {
    super(left === null ? t("appLock.wrongPasscode") : left > 0 ? t("appLock.wrongPasscodeTriesLeft", { count: left }) : t("appLock.tooManyWrongPasscodes"));
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

const INFO_VERIFY = utf8.enc("evilion-chat/app-lock-verify/v1");

/**
 * A value another device can compare a passcode against. It is derived one way
 * from the passcode key, so holding it proves nothing and unlocks nothing.
 */
function verifierOf(key: Uint8Array): string {
  return b64.enc(hkdf(sha256, key, new Uint8Array(0), INFO_VERIFY, 32));
}

/** True for a passcode a phone's number pad can type. */
export function isNumeric(passcode: string): boolean {
  return /^\d+$/.test(passcode);
}

/** Returns why a passcode is unacceptable, or null when it is fine. */
export function passcodeProblem(passcode: string): string | null {
  if (isNumeric(passcode) && passcode.length < MIN_NUMERIC_PASSCODE) return t("appLock.useAtLeastDigits", { count: MIN_NUMERIC_PASSCODE });
  if (passcode.length < MIN_PASSCODE) return t("appLock.useAtLeastCharacters", { count: MIN_PASSCODE });
  if (passcode.length > 128) return t("appLock.thatIsTooLong");
  if (/^(.)\1*$/.test(passcode)) return t("appLock.pickSomethingLessGuessableThanOne");
  return null;
}

export type LockOptions = Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">> & {
  /** Stretching cost. Only tests pass this; everything else wants LOCK_KDF. */
  kdf?: KdfParams;
};

/** Turns the lock on: wraps the identity with the passcode and stores it. */
export async function enableLock(userId: string, identity: Identity, passcode: string, opts?: LockOptions): Promise<LockConfig> {
  const problem = passcodeProblem(passcode);
  if (problem) throw new ReadableError(problem);
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
    numeric: isNumeric(passcode),
  };
  saveLock(userId, cfg);
  return cfg;
}

/** The account-wide policy for a lock that was just set up on this device. */
export async function policyFor(cfg: LockConfig, passcode: string): Promise<AppLockPolicy> {
  const key = await passcodeKey(passcode, b64.dec(cfg.salt), cfg.params);
  return {
    salt: cfg.salt,
    params: cfg.params,
    verifier: verifierOf(key),
    autoLockMs: cfg.autoLockMs,
    lockOnBlur: cfg.lockOnBlur,
    blurDelayMs: cfg.blurDelayMs,
  };
}

/**
 * Takes on the account's passcode on a device that has not seen it before:
 * checks the passcode against the policy, then wraps this device's copy of the
 * identity with it. Throws WrongPasscode if it does not match.
 */
export async function adoptPolicy(userId: string, identity: Identity, passcode: string, policy: AppLockPolicy): Promise<LockConfig> {
  const key = await passcodeKey(passcode, b64.dec(policy.salt), policy.params);
  // No count here, because there is nothing to count against: this is the
  // branch for a device that has no wrapped key yet, so there is none to throw
  // away and the tries the message used to promise were never enforced. It
  // read "9 tries left" however many times the passcode was got wrong.
  if (!equal(utf8.enc(verifierOf(key)), utf8.enc(policy.verifier))) throw new WrongPasscode(null);
  const wrapped = await wrapPrivateKey(identity.privateKey, key);
  const next: LockConfig = {
    v: 1,
    salt: policy.salt,
    params: policy.params,
    wrapped: b64.enc(wrapped),
    pub: b64.enc(identity.publicKey),
    autoLockMs: policy.autoLockMs,
    lockOnBlur: policy.lockOnBlur,
    blurDelayMs: policy.blurDelayMs,
    failures: 0,
    numeric: isNumeric(passcode),
  };
  saveLock(userId, next);
  return next;
}

/**
 * Rebuilds the identity from a passcode. A wrong one counts against the
 * allowance and, once it runs out, deletes the wrapped key so nobody can keep
 * guessing offline; the account password still gets the owner back in.
 */
export async function unlockIdentity(userId: string, passcode: string): Promise<Identity> {
  const cfg = loadLock(userId);
  if (!cfg) throw new ReadableError(t("appLock.thisDeviceHasNoPasscode"));
  const key = await passcodeKey(passcode, b64.dec(cfg.salt), cfg.params);
  try {
    const privateKey = await unwrapPrivateKey(b64.dec(cfg.wrapped), key);
    const numeric = isNumeric(passcode);
    if (cfg.failures !== 0 || cfg.numeric !== numeric) saveLock(userId, { ...cfg, failures: 0, numeric });
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
