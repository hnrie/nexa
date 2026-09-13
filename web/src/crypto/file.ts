/**
 * Chunked attachment encryption.
 *
 * Layout: "ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext].
 * Chunk `i` covers input bytes [i*CHUNK, (i+1)*CHUNK) and is encrypted under
 * iv = base iv ‖ u32be(i), which binds each chunk to its position: chunks cannot
 * be reordered, dropped or spliced in from another file without failing the tag.
 * A zero-length input still produces one chunk, so an empty file authenticates.
 *
 * Input is read one slice at a time. Output is either produced frame by frame
 * (encryptFrames, for streaming a large file straight into an upload) or folded
 * into a Blob every few megabytes, so neither direction ever holds a whole
 * large file in memory. Holding one entire was what took a 16 GB machine down
 * when a 15 GB file was sent.
 */

import { IV_LEN, TAG_LEN, bufferSource, gcmDecrypt, gcmEncrypt } from "./aes";
import { concat, equal, randomBytes, readU32be, u32be, utf8 } from "./bytes";
import { DecryptError } from "./keys";

export const CHUNK = 4 * 1024 * 1024;

const MAGIC = utf8.enc("ECF1");
const BASE_IV_LEN = IV_LEN - 4;
const HEADER_LEN = MAGIC.length + BASE_IV_LEN;
const LEN_PREFIX = 4;
const FILE_AAD = utf8.enc("file/v1");
const KEY_LEN = 32;

/** How many chunks are held before they are folded into a Blob. */
const FOLD_EVERY = 8;

/** The exact size of the ciphertext for `plainSize` bytes, known before encrypting. */
export function encryptedSize(plainSize: number): number {
  const count = Math.max(1, Math.ceil(plainSize / CHUNK));
  return HEADER_LEN + count * (LEN_PREFIX + TAG_LEN) + plainSize;
}

export function newFileKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

/**
 * Yields the ciphertext of `data` in order: the header first, then one frame
 * per chunk. Only one chunk is ever held at a time.
 */
export async function* encryptFrames(
  data: Blob,
  key: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): AsyncGenerator<Uint8Array> {
  const baseIv = randomBytes(BASE_IV_LEN);
  const total = data.size;
  const count = Math.max(1, Math.ceil(total / CHUNK));
  yield concat(MAGIC, baseIv);
  for (let i = 0; i < count; i++) {
    const start = i * CHUNK;
    const end = Math.min(start + CHUNK, total);
    const plaintext = new Uint8Array(await data.slice(start, end).arrayBuffer());
    const ct = await gcmEncrypt(key, concat(baseIv, u32be(i)), plaintext, FILE_AAD);
    yield concat(u32be(ct.length), ct);
    onProgress?.(end, total);
  }
}

export async function encryptFile(
  data: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ key: Uint8Array; blob: Blob }> {
  const key = newFileKey();
  let acc = new Blob([]);
  let batch: BlobPart[] = [];
  for await (const frame of encryptFrames(data, key, onProgress)) {
    batch.push(bufferSource(frame));
    if (batch.length >= FOLD_EVERY) {
      acc = new Blob([acc, ...batch]);
      batch = [];
    }
  }
  return { key, blob: new Blob([acc, ...batch]) };
}

interface ChunkSpan {
  start: number;
  len: number;
}

/**
 * Walk the length prefixes without decrypting, so the plaintext size is known
 * before any work starts and truncation is caught up front.
 */
async function scanChunks(blob: Blob): Promise<ChunkSpan[]> {
  const spans: ChunkSpan[] = [];
  let off = HEADER_LEN;
  while (off < blob.size) {
    if (off + LEN_PREFIX > blob.size) throw new DecryptError("file: truncated chunk header");
    const len = readU32be(new Uint8Array(await blob.slice(off, off + LEN_PREFIX).arrayBuffer()), 0);
    off += LEN_PREFIX;
    if (len < TAG_LEN || off + len > blob.size) throw new DecryptError("file: truncated chunk");
    spans.push({ start: off, len });
    off += len;
  }
  if (spans.length === 0) throw new DecryptError("file: no chunks");
  return spans;
}

export async function decryptFile(
  blob: Blob,
  key: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (blob.size < HEADER_LEN) throw new DecryptError("file: truncated header");
  const header = new Uint8Array(await blob.slice(0, HEADER_LEN).arrayBuffer());
  if (!equal(header.subarray(0, MAGIC.length), MAGIC)) throw new DecryptError("file: bad magic");
  const baseIv = header.subarray(MAGIC.length, HEADER_LEN);

  const spans = await scanChunks(blob);
  const total = spans.reduce((n, s) => n + s.len - TAG_LEN, 0);

  let acc = new Blob([]);
  let batch: BlobPart[] = [];
  let done = 0;
  for (const [i, span] of spans.entries()) {
    const ct = new Uint8Array(await blob.slice(span.start, span.start + span.len).arrayBuffer());
    let plaintext: Uint8Array;
    try {
      plaintext = await gcmDecrypt(key, concat(baseIv, u32be(i)), ct, FILE_AAD);
    } catch {
      throw new DecryptError("file: chunk failed to authenticate");
    }
    batch.push(bufferSource(plaintext));
    // hand finished chunks to the browser's blob store rather than keeping
    // every one alive in the page until the end
    if (batch.length >= FOLD_EVERY) {
      acc = new Blob([acc, ...batch]);
      batch = [];
    }
    done += plaintext.length;
    onProgress?.(done, total);
  }
  return new Blob([acc, ...batch]);
}
