/**
 * Call keys for guests. A guest link carries the call's key for one epoch in
 * its fragment, which never reaches the server. When the conversation's key
 * changes during the link's life, the people in the call hand the guest the
 * newer call keys, sealed under a key derived from the one the link carried:
 * the server relays what it cannot read, and only whoever holds the link can
 * open it.
 */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcmDecrypt, gcmEncrypt } from "@/crypto/aes";
import { b64, randomBytes, utf8 } from "@/crypto/bytes";
import { voiceFrameKey } from "@/crypto/conv";
import type { VoiceKeys } from "./e2ee";

/** The call keys this page holds as a guest: by channel, then by epoch. */
const held = new Map<string, Map<number, Uint8Array>>();

/** At most this many keys are taken from one relay, which is more rotations than a guest's stay sees. */
const MAX_RELAYED = 32;

export function setGuestKey(channelId: string, epoch: number, key: Uint8Array): void {
  let keys = held.get(channelId);
  if (!keys) held.set(channelId, (keys = new Map()));
  keys.set(epoch, key);
}

export function clearGuestKeys(): void {
  held.clear();
}

export function hasGuestKeys(channelId: string): boolean {
  return (held.get(channelId)?.size ?? 0) > 0;
}

/** The call keys a guest holds for a channel, sealing with the newest; null for a page that is not a guest's. */
export function guestVoiceKeys(channelId: string): VoiceKeys | null {
  const keys = held.get(channelId);
  if (!keys || keys.size === 0) return null;
  const epochs = [...keys.keys()].sort((a, b) => a - b);
  const newest = epochs[epochs.length - 1]!;
  return { keys: epochs.map((epoch) => ({ index: epoch & 0xff, raw: keys.get(epoch)! })), send: newest & 0xff, version: `guest:${channelId}:${epochs.join(",")}` };
}

/** Relayed keys are sealed with a key derived from the link's call key, never with a key that seals frames. */
function relayKey(linkKey: Uint8Array): Uint8Array {
  return hkdf(sha256, linkKey, new Uint8Array(0), utf8.enc("guest-relay"), 32);
}

/** Binds a sealed key to its call, its guest and its epoch, so it cannot be passed off as another. */
function relayAad(channelId: string, guestId: string, epoch: number): Uint8Array {
  return utf8.enc(`guest-key:${channelId}:${guestId}:${epoch}`);
}

export interface RelayedKeys {
  /** The epoch of the key they are sealed under: the one the guest's link carried. */
  base: number;
  keys: { epoch: number; iv: string; ct: string }[];
}

/**
 * Seals the call keys newer than a guest's link for that guest, from the
 * conversation's roots (`rootOf`) over `epochs`. Null when this device does
 * not hold the link's epoch, or has nothing newer to give.
 */
export async function sealKeysForGuest(channelId: string, guestId: string, base: number, epochs: number[], rootOf: (epoch: number) => Uint8Array | undefined): Promise<RelayedKeys | null> {
  const baseRoot = rootOf(base);
  if (!baseRoot) return null;
  const wrap = relayKey(voiceFrameKey(baseRoot, channelId));
  const keys: RelayedKeys["keys"] = [];
  for (const epoch of epochs) {
    const root = epoch > base ? rootOf(epoch) : undefined;
    if (!root) continue;
    const iv = randomBytes(12);
    const ct = await gcmEncrypt(wrap, iv, voiceFrameKey(root, channelId), relayAad(channelId, guestId, epoch));
    keys.push({ epoch, iv: b64.enc(iv), ct: b64.enc(ct) });
  }
  return keys.length > 0 ? { base, keys } : null;
}

function isRelayed(x: unknown): x is RelayedKeys {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Partial<RelayedKeys>;
  return Number.isInteger(r.base) && Array.isArray(r.keys) && r.keys.length <= MAX_RELAYED;
}

/**
 * Opens call keys someone in the call sealed for this guest (`meId`), keeping
 * the ones that open. Returns how many new keys it now holds.
 */
export async function openRelayedKeys(channelId: string, meId: string, payload: unknown): Promise<number> {
  if (!isRelayed(payload)) return 0;
  const keys = held.get(channelId);
  const linkKey = keys?.get(payload.base);
  if (!keys || !linkKey) return 0;
  const wrap = relayKey(linkKey);
  let added = 0;
  for (const k of payload.keys) {
    if (!Number.isInteger(k?.epoch) || k.epoch <= payload.base || keys.has(k.epoch) || typeof k.iv !== "string" || typeof k.ct !== "string") continue;
    try {
      const raw = await gcmDecrypt(wrap, b64.dec(k.iv), b64.dec(k.ct), relayAad(channelId, meId, k.epoch));
      if (raw.length !== 32) continue;
      keys.set(k.epoch, raw);
      added++;
    } catch {
      /* sealed for someone else, or altered on the way */
    }
  }
  return added;
}
