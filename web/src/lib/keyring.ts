import { KeyRing, channelKey } from "@/crypto/conv";

/** The in-memory root keys for every conversation this session can read. */
export const ring = new KeyRing();

/**
 * How many derived channel keys are kept.
 *
 * There is one per channel per key epoch, old epochs are needed to read
 * history, and a rotation lands on every membership change, so nothing here
 * ever stops being wanted. Bounded instead: an entry that falls out costs one
 * derivation to make again.
 */
const MAX_CHAN_KEYS = 512;

const chanKeys = new Map<string, Uint8Array>();

/** Channel key for (conv, epoch, channel), memoised; undefined without the root. */
export function channelKeyFor(conv: string, epoch: number, channelId: string): Uint8Array | undefined {
  const k = `${conv}:${epoch}:${channelId}`;
  const cached = chanKeys.get(k);
  if (cached) {
    // re-inserting moves it to the end, so the first key out is the one unused longest
    chanKeys.delete(k);
    chanKeys.set(k, cached);
    return cached;
  }
  const root = ring.get(conv, epoch);
  if (!root) return undefined;
  const derived = channelKey(root, channelId);
  chanKeys.set(k, derived);
  if (chanKeys.size > MAX_CHAN_KEYS) {
    const oldest = chanKeys.keys().next();
    if (!oldest.done) chanKeys.delete(oldest.value);
  }
  return derived;
}

export function clearKeyring(): void {
  ring.clear();
  chanKeys.clear();
}
