/**
 * The attachment format, down to where each chunk sits, kept apart from the
 * rest of the crypto code so uploads can prepare a piece without loading any
 * unrelated cryptography.
 *
 * Layout: "ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext].
 * Chunk `i` covers input bytes [i*CHUNK, (i+1)*CHUNK) and is encrypted under
 * iv = base iv ‖ u32be(i), which binds each chunk to its position: chunks cannot
 * be reordered, dropped or spliced in from another file without failing the tag.
 * A zero-length input still produces one chunk, so an empty file authenticates.
 *
 * Every chunk but the last is exactly CHUNK bytes, so where any chunk's frame
 * starts is known without encrypting what comes before it. That lets any
 * stretch of a file be encrypted on its own, and since the same key, iv and
 * bytes always give the same ciphertext, a stretch sent again after a failure
 * comes out identical.
 */

import { IV_LEN, TAG_LEN, bufferSource, gcmEncrypt } from "./aes";
import { concat, randomBytes, u32be, utf8 } from "./bytes";

export const CHUNK = 4 * 1024 * 1024;
export const MAGIC = utf8.enc("ECF1");
export const BASE_IV_LEN = IV_LEN - 4;
export const HEADER_LEN = MAGIC.length + BASE_IV_LEN;
export const LEN_PREFIX = 4;
/** The frame of every chunk but the last. */
export const FRAME_LEN = LEN_PREFIX + CHUNK + TAG_LEN;
export const FILE_AAD = utf8.enc("file/v1");
const KEY_LEN = 32;

export function chunkCount(plainSize: number): number {
  return Math.max(1, Math.ceil(plainSize / CHUNK));
}

/** The exact size of the ciphertext for `plainSize` bytes, known before encrypting. */
export function encryptedSize(plainSize: number): number {
  return HEADER_LEN + chunkCount(plainSize) * (LEN_PREFIX + TAG_LEN) + plainSize;
}

/** Where chunk `i`'s frame begins in the ciphertext; chunk 0's stretch also takes in the header before it. */
export function frameOffset(i: number): number {
  return HEADER_LEN + i * FRAME_LEN;
}

export function newFileKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

export function newBaseIv(): Uint8Array {
  return randomBytes(BASE_IV_LEN);
}

/** Chunk `i`'s frame: its length, then its ciphertext. */
export async function encryptChunk(data: Blob, key: Uint8Array, baseIv: Uint8Array, i: number): Promise<Uint8Array> {
  const start = i * CHUNK;
  const plaintext = new Uint8Array(await data.slice(start, Math.min(start + CHUNK, data.size)).arrayBuffer());
  const ct = await gcmEncrypt(key, concat(baseIv, u32be(i)), plaintext, FILE_AAD);
  return concat(u32be(ct.length), ct);
}

/**
 * The ciphertext of chunks [first, first + count), preceded by the header
 * when `first` is 0: the bytes that belong at [frameOffset(first) or 0,
 * frameOffset(first + count)) in the whole encrypted file.
 */
export async function encryptChunks(data: Blob, key: Uint8Array, baseIv: Uint8Array, first: number, count: number): Promise<Uint8Array<ArrayBuffer>> {
  const chunks = chunkCount(data.size);
  if (!Number.isInteger(first) || !Number.isInteger(count) || first < 0 || count < 1 || first + count > chunks) {
    throw new RangeError("encryptChunks: no such chunks");
  }
  if (baseIv.length !== BASE_IV_LEN) throw new RangeError("encryptChunks: base iv must be 8 bytes");
  const plain = Math.min(data.size, (first + count) * CHUNK) - first * CHUNK;
  const head = first === 0 ? HEADER_LEN : 0;
  const out = new Uint8Array(head + count * (LEN_PREFIX + TAG_LEN) + plain);
  let off = 0;
  if (head) {
    out.set(MAGIC, 0);
    out.set(baseIv, MAGIC.length);
    off = HEADER_LEN;
  }
  const imported = await crypto.subtle.importKey("raw", bufferSource(key), "AES-GCM", false, ["encrypt"]);
  const lengths = new DataView(out.buffer);
  for (let i = first; i < first + count; i++) {
    const start = i * CHUNK;
    const plaintext = await data.slice(start, Math.min(start + CHUNK, data.size)).arrayBuffer();
    const iv = concat(baseIv, u32be(i));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv), additionalData: bufferSource(FILE_AAD) }, imported, plaintext);
    // Write the frame straight into the request buffer, without another
    // chunk-sized allocation and copy just to prepend its length.
    lengths.setUint32(off, ct.byteLength);
    out.set(new Uint8Array(ct), off + LEN_PREFIX);
    off += LEN_PREFIX + ct.byteLength;
  }
  return out;
}
