/**
 * The identity keys this device has seen before.
 *
 * Every public key a client encrypts to arrives from the server, and the server
 * is the party the product promises is shut out. Nothing in the protocol stops
 * it handing out a key of its own choosing for somebody and collecting the
 * conversation keys that get sealed to it. Trust on first use is the cheap
 * defence: remember the key the first time this device sees a person, and treat
 * a different one later as something a human has to look at.
 *
 * What makes that a fair rule here rather than a nuisance is that **there is no
 * update path for `public_key` in the API**. `CreateUser` writes it at
 * registration (`internal/store/users.go`, from
 * `internal/api/auth_handlers.go`); every other write to the `users` row —
 * profile edits, password changes, recovery replacement, account deletion —
 * leaves the column alone, and nothing reads a new one off the wire. A user id
 * is a fresh snowflake per registration, so even signing up again produces a
 * *different id*, not the same id with a new key. A changed key is therefore
 * either a restored database, a migration, or an attack, and none of those
 * should be waved through.
 *
 * The pins are kept per device, in localStorage, and never sent anywhere. Put
 * them on the server and they would be worth exactly as much as the keys they
 * are meant to check. They deliberately survive signing out and back in: the
 * whole value is in the memory being long, and a pin is public information, so
 * there is nothing here for a later user of the browser to steal.
 */

import { storage } from "./storage";

export type PinVerdict =
  /** No key to judge — a placeholder user, a guest, a stripped payload. */
  | "unknown"
  /** Never seen this person before; the key is now pinned. */
  | "first"
  /** Same key as last time. */
  | "same"
  /** A different key from the pinned one. Nothing is sealed to it until a human says so. */
  | "changed";

interface PinFile {
  v: 1;
  /** user id → base64 x25519 public key. */
  keys: Record<string, string>;
  /** When this device started keeping pins, so the interface can say "since". */
  since: number;
}

/**
 * A crowded server can hand over thousands of user objects. Pins are small, but
 * localStorage is not, and a quota error there is silent. Past this many the
 * oldest-recorded pins are dropped; dropping one costs the warning on a key
 * change for that person, not access to anything.
 */
const MAX_PINS = 4000;

/** Writes are batched: a gateway ready upserts every user in one go. */
const FLUSH_MS = 1000;

let account: string | null = null;
let file: PinFile | null = null;
let flush: ReturnType<typeof setTimeout> | null = null;
/** Insertion order, so the eviction above has something to go on. */
let order: string[] = [];
/**
 * The people whose key this device first learned during *this* session.
 *
 * The security decision never uses this — a pin is a pin. It exists so the
 * interface can tell the truth: a second device signing in pins everybody it
 * has never met within a second of connecting, and a badge reading "same key as
 * before" a moment later would be claiming a check that never happened.
 */
let fresh = new Set<string>();
/** Whether this device knew nothing at all when the session began. */
let startedBlank = true;

function keyFor(userId: string): string {
  return `ec.keypins.${userId}`;
}

function empty(): PinFile {
  return { v: 1, keys: {}, since: Date.now() };
}

function load(userId: string): PinFile {
  const raw = storage.get(keyFor(userId));
  if (!raw) return empty();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const p = parsed as Partial<PinFile>;
    if (p.v !== 1 || !p.keys || typeof p.keys !== "object") return empty();
    const keys: Record<string, string> = {};
    for (const [id, k] of Object.entries(p.keys)) if (typeof k === "string" && k) keys[id] = k;
    return { v: 1, keys, since: typeof p.since === "number" ? p.since : Date.now() };
  } catch {
    // Corrupt pins are the same situation as no pins: a device that has to
    // learn everyone again, which is safe, just less watchful.
    return empty();
  }
}

function persist(): void {
  if (flush) clearTimeout(flush);
  flush = setTimeout(() => {
    flush = null;
    if (!account || !file) return;
    storage.set(keyFor(account), JSON.stringify(file));
  }, FLUSH_MS);
}

/** Writes now rather than on the timer, for the paths that must not lose a pin. */
function persistNow(): void {
  if (flush) {
    clearTimeout(flush);
    flush = null;
  }
  if (!account || !file) return;
  storage.set(keyFor(account), JSON.stringify(file));
}

/** Starts keeping pins for a signed-in account. Called when the keys come up. */
export function openPins(userId: string): void {
  if (account === userId && file) return;
  persistNow();
  account = userId;
  file = load(userId);
  order = Object.keys(file.keys);
  fresh = new Set();
  startedBlank = order.length === 0;
}

/** Stops, on sign-out. The pins themselves stay on the device on purpose. */
export function closePins(): void {
  persistNow();
  account = null;
  file = null;
  order = [];
  fresh = new Set();
  startedBlank = true;
}

/** Whether this device has any memory at all — false on a second device's first run. */
export function hasPins(): boolean {
  return !!file && order.length > 0;
}

/** When this device started remembering, for the interface to be honest about how much it knows. */
export function pinsSince(): number | null {
  return file ? file.since : null;
}

/**
 * Whether this device only learned this person's key during this session, so
 * nothing about it has been checked against anything.
 */
export function learnedThisSession(userId: string): boolean {
  return fresh.has(userId);
}

/** Whether the device began this session knowing nobody's key. */
export function startedWithNoPins(): boolean {
  return startedBlank;
}

export function pinnedKey(userId: string): string | null {
  return file?.keys[userId] ?? null;
}

/** What this device thinks of a key, without changing anything. */
export function checkKey(userId: string, publicKeyB64: string | null | undefined): PinVerdict {
  if (!publicKeyB64) return "unknown";
  if (!file) return "unknown";
  const have = file.keys[userId];
  if (!have) return "first";
  return have === publicKeyB64 ? "same" : "changed";
}

/**
 * Records a key as this person's. Used both for a first sighting and for a
 * change a human has looked at and accepted; there is deliberately no way to
 * accept one without saying so, since that is the entire point of the file.
 */
export function pinKey(userId: string, publicKeyB64: string): void {
  if (!file || !publicKeyB64) return;
  if (userId in file.keys) {
    // Overwriting an existing pin only happens when a human accepted a change,
    // which is a stronger statement than "seen before" — not a fresh sighting.
    fresh.delete(userId);
  } else {
    fresh.add(userId);
    order.push(userId);
    while (order.length > MAX_PINS) {
      const drop = order.shift();
      if (drop !== undefined && drop !== userId) {
        delete file.keys[drop];
        fresh.delete(drop);
      }
    }
  }
  file.keys[userId] = publicKeyB64;
  persist();
}

/**
 * The first-sight path: judge a key and pin it if this device has never seen
 * one for that person. A change is reported, never recorded.
 */
export function notePublicKey(userId: string, publicKeyB64: string | null | undefined): PinVerdict {
  const verdict = checkKey(userId, publicKeyB64);
  if (verdict === "first" && publicKeyB64) pinKey(userId, publicKeyB64);
  return verdict;
}

/** Forgets one person, so the next key seen for them is pinned afresh. */
export function forgetPin(userId: string): void {
  if (!file || !(userId in file.keys)) return;
  delete file.keys[userId];
  order = order.filter((id) => id !== userId);
  fresh.delete(userId);
  persistNow();
}
