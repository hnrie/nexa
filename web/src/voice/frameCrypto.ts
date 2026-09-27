/**
 * End-to-end encryption of call frames. Calls go through Cloudflare's SFU,
 * which ends the WebRTC transport encryption, so every frame is sealed again
 * with the conversation's key before it leaves the browser. The SFU forwards
 * what it cannot read.
 *
 * A sealed frame is: the clear header | AES-GCM ciphertext and tag | iv | key
 * index. The header is what packetizers and the SFU look at (Opus's TOC byte,
 * VP8's payload header) and is authenticated as additional data, so it cannot
 * be altered either. The key index says which epoch's key sealed the frame,
 * so a call keeps playing while keys rotate.
 */

export type FrameKind = "audio" | "video";

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
const TRAILER = IV_BYTES + 1;

/** How many leading bytes stay readable: Opus's TOC byte, VP8's payload header (10 on key frames, 3 otherwise). */
export function clearBytes(kind: FrameKind, keyFrame: boolean): number {
  if (kind === "audio") return 1;
  return keyFrame ? 10 : 3;
}

/** The random part of an IV. It is long enough that no two senders under one key pick the same. */
export const SALT_BYTES = 8;
/** The counter after the salt; a sender that reaches it picks a new salt. */
export const MAX_FRAME_COUNTER = 0xffffffff;

/**
 * An 8-byte salt, random per sender, then a 4-byte counter: never the same IV
 * twice under one key. Receivers read the IV from the frame, so its layout is
 * the sender's business.
 */
export function frameIv(salt: Uint8Array, counter: number): Uint8Array {
  const iv = new Uint8Array(IV_BYTES);
  iv.set(salt.subarray(0, SALT_BYTES), 0);
  new DataView(iv.buffer).setUint32(SALT_BYTES, counter);
  return iv;
}

export function importFrameKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealFrame(key: CryptoKey, index: number, iv: Uint8Array, data: Uint8Array, clear: number): Promise<Uint8Array> {
  const n = Math.min(clear, data.length);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: data.subarray(0, n) as BufferSource }, key, data.subarray(n) as BufferSource));
  const out = new Uint8Array(n + sealed.length + TRAILER);
  out.set(data.subarray(0, n), 0);
  out.set(sealed, n);
  out.set(iv, n + sealed.length);
  out[out.length - 1] = index & 0xff;
  return out;
}

/** The frame as it was sealed, or null when no key opens it or it was altered. */
export async function openFrame(keys: ReadonlyMap<number, CryptoKey>, data: Uint8Array, clear: number): Promise<Uint8Array | null> {
  if (data.length < TRAILER + TAG_BYTES) return null;
  const key = keys.get(data[data.length - 1]!);
  if (!key) return null;
  const body = data.length - TRAILER;
  const n = Math.min(clear, body - TAG_BYTES);
  const iv = data.slice(body, body + IV_BYTES);
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: data.subarray(0, n) as BufferSource }, key, data.subarray(n, body) as BufferSource));
    const out = new Uint8Array(n + plain.length);
    out.set(data.subarray(0, n), 0);
    out.set(plain, n);
    return out;
  } catch {
    return null;
  }
}
