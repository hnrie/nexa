import { KeyRing, channelKey } from "@/crypto/conv";

/** The in-memory root keys for every conversation this session can read. */
export const ring = new KeyRing();

const chanKeys = new Map<string, Uint8Array>();

/** Channel key for (conv, epoch, channel), memoised; undefined without the root. */
export function channelKeyFor(conv: string, epoch: number, channelId: string): Uint8Array | undefined {
  const k = `${conv}:${epoch}:${channelId}`;
  const cached = chanKeys.get(k);
  if (cached) return cached;
  const root = ring.get(conv, epoch);
  if (!root) return undefined;
  const derived = channelKey(root, channelId);
  chanKeys.set(k, derived);
  return derived;
}

export function clearKeyring(): void {
  ring.clear();
  chanKeys.clear();
}
