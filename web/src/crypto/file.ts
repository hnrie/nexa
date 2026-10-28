/**
 * Chunked attachment encryption; the layout itself is described in
 * fileChunks.ts.
 *
 * Input is read one slice at a time, and output is folded into a Blob every
 * few megabytes, so a whole large file is never gathered in the page's memory
 * in one piece. Uploads do not come through here at all: they encrypt each
 * stretch into a request buffer, one piece ahead (see lib/attachments.ts).
 */

import { TAG_LEN, bufferSource, gcmDecrypt } from "./aes";
import { concat, equal, readU32be, u32be } from "./bytes";
import { CHUNK, FILE_AAD, HEADER_LEN, LEN_PREFIX, MAGIC, chunkCount, encryptChunk, newBaseIv, newFileKey } from "./fileChunks";
import { DecryptError } from "./keys";

export { CHUNK, chunkCount, encryptChunks, encryptedSize, newBaseIv, newFileKey } from "./fileChunks";

/** How many chunks are held before they are folded into a Blob. */
const FOLD_EVERY = 8;

export async function encryptFile(
  data: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ key: Uint8Array; blob: Blob }> {
  const key = newFileKey();
  const baseIv = newBaseIv();
  const total = data.size;
  let acc = new Blob([bufferSource(MAGIC), bufferSource(baseIv)]);
  let batch: BlobPart[] = [];
  for (let i = 0; i < chunkCount(total); i++) {
    batch.push(bufferSource(await encryptChunk(data, key, baseIv, i)));
    if (batch.length >= FOLD_EVERY) {
      acc = new Blob([acc, ...batch]);
      batch = [];
    }
    onProgress?.(Math.min((i + 1) * CHUNK, total), total);
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
    if (len < TAG_LEN || len > CHUNK + TAG_LEN || off + len > blob.size) throw new DecryptError("file: truncated chunk");
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
  expectedSize?: number,
): Promise<Blob> {
  if (blob.size < HEADER_LEN) throw new DecryptError("file: truncated header");
  const header = new Uint8Array(await blob.slice(0, HEADER_LEN).arrayBuffer());
  if (!equal(header.subarray(0, MAGIC.length), MAGIC)) throw new DecryptError("file: bad magic");
  const baseIv = header.subarray(MAGIC.length, HEADER_LEN);

  const spans = await scanChunks(blob);
  const total = spans.reduce((n, s) => n + s.len - TAG_LEN, 0);
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || total !== expectedSize || spans.length !== chunkCount(expectedSize))) throw new DecryptError("file: truncated file");
  if (expectedSize !== undefined && spans.some((span, i) => span.len - TAG_LEN !== Math.min(CHUNK, expectedSize - i * CHUNK))) throw new DecryptError("file: unexpected chunk size");

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
