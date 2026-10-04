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
 *
 * An H.264 frame is read at more places than its start (h264.ts), so it is
 * sealed where it lies: every NAL unit after a 4-byte start code, its
 * readable part as it was and the rest sealed, all under one AES-GCM
 * operation whose additional data is the readable parts joined, then the tag,
 * the iv and the key index after the last unit.
 */
import { naluClearBytes, naluIndices, type Nalu } from "./h264";

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
 * IVs have no zero byte in them: two zeros and a one would be a start code,
 * and a start code in a sealed H.264 frame would split it in the packetizer
 * (sealH264Frame refuses such a frame). So a salt is drawn again where it
 * has a zero, and the counter runs through the numbers whose four bytes are
 * 1 to 255, from FIRST_FRAME_COUNTER on.
 */
export const FIRST_FRAME_COUNTER = 0x01010101;

export function newSalt(): Uint8Array {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  for (let i = 0; i < salt.length; i++) while (salt[i] === 0) salt[i] = crypto.getRandomValues(new Uint8Array(1))[0]!;
  return salt;
}

/** The counter after `n`, its bytes all 1 to 255; past MAX_FRAME_COUNTER when there is none. */
export function nextCounter(n: number): number {
  let next = n + 1;
  // a byte that rolled over to zero becomes 1 (the byte above it was carried into already)
  for (let shift = 0; shift < 32; shift += 8) if (((next >>> shift) & 0xff) === 0) next += 2 ** shift;
  return next;
}

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

/** What sealing adds after an H.264 frame's last NAL unit: the tag, the iv and the key index. */
export const H264_TRAILER = TAG_BYTES + IV_BYTES + 1;
const START_CODE = [0, 0, 0, 1];

/** An H.264 frame's NAL units and how many bytes of each stay readable; null when it is not one this can seal. */
function h264Layout(data: Uint8Array): { nalus: Nalu[]; clear: number[] } | null {
  const nalus = naluIndices(data);
  if (nalus.length === 0 || nalus[0]!.start !== 0) return null;
  const clear: number[] = [];
  for (const nalu of nalus) {
    const n = naluClearBytes(data, nalu);
    if (n === null) return null;
    clear.push(n);
  }
  return { nalus, clear };
}

/** The readable parts of a frame's NAL units joined (the additional data), and the rest joined (what is sealed). */
function h264Parts(data: Uint8Array, nalus: Nalu[], clear: number[], extra: number): { aad: Uint8Array; secret: Uint8Array } {
  let aadLen = 0;
  let secretLen = 0;
  nalus.forEach((n, i) => {
    aadLen += clear[i]!;
    secretLen += n.end - n.payload - clear[i]!;
  });
  const aad = new Uint8Array(aadLen);
  const secret = new Uint8Array(secretLen + extra);
  let a = 0;
  let c = 0;
  nalus.forEach((n, i) => {
    const mid = n.payload + clear[i]!;
    aad.set(data.subarray(n.payload, mid), a);
    a += clear[i]!;
    secret.set(data.subarray(mid, n.end), c);
    c += n.end - mid;
  });
  return { aad, secret };
}

/**
 * Seals an H.264 frame. Null when it is not a frame this can seal, or when
 * the sealed bytes happen to hold a start code, which would split a NAL unit
 * in the packetizer: the caller then seals again with the next iv.
 */
export async function sealH264Frame(key: CryptoKey, index: number, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array | null> {
  const layout = h264Layout(data);
  if (!layout) return null;
  const { nalus, clear } = layout;
  const { aad, secret } = h264Parts(data, nalus, clear, 0);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource }, key, secret as BufferSource));
  const size = nalus.reduce((sum, n) => sum + START_CODE.length + n.end - n.payload, 0);
  const out = new Uint8Array(size + H264_TRAILER);
  let o = 0;
  let c = 0;
  nalus.forEach((n, i) => {
    out.set(START_CODE, o);
    o += START_CODE.length;
    out.set(data.subarray(n.payload, n.payload + clear[i]!), o);
    o += clear[i]!;
    const rest = n.end - n.payload - clear[i]!;
    out.set(sealed.subarray(c, c + rest), o);
    o += rest;
    c += rest;
  });
  out.set(sealed.subarray(c), o);
  out.set(iv, o + TAG_BYTES);
  out[out.length - 1] = index & 0xff;
  // the packetizer has to find the units it was given, and nothing more
  const found = naluIndices(out);
  if (found.length !== nalus.length) return null;
  for (let i = 0; i < nalus.length; i++) {
    const want = nalus[i]!.end - nalus[i]!.payload + (i === nalus.length - 1 ? H264_TRAILER : 0);
    if (found[i]!.end - found[i]!.payload !== want) return null;
  }
  return out;
}

/** An H.264 frame as it was sealed, or null when no key opens it or it was altered. */
export async function openH264Frame(keys: ReadonlyMap<number, CryptoKey>, data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length < H264_TRAILER + START_CODE.length + 1) return null;
  const key = keys.get(data[data.length - 1]!);
  if (!key) return null;
  const bodyLen = data.length - H264_TRAILER;
  const body = data.subarray(0, bodyLen);
  const layout = h264Layout(body);
  if (!layout) return null;
  const { nalus, clear } = layout;
  const { aad, secret } = h264Parts(body, nalus, clear, TAG_BYTES);
  secret.set(data.subarray(bodyLen, bodyLen + TAG_BYTES), secret.length - TAG_BYTES);
  const iv = data.slice(bodyLen + TAG_BYTES, bodyLen + TAG_BYTES + IV_BYTES);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad as BufferSource }, key, secret as BufferSource));
  } catch {
    return null;
  }
  const out = body.slice();
  let c = 0;
  nalus.forEach((n, i) => {
    const mid = n.payload + clear[i]!;
    out.set(plain.subarray(c, c + n.end - mid), mid);
    c += n.end - mid;
  });
  return out;
}
