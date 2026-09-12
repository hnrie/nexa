/**
 * Chunked attachment encryption.
 *
 * Layout: "ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext].
 * Chunk `i` covers input bytes [i*CHUNK, (i+1)*CHUNK) and is encrypted under
 * iv = base iv ‖ u32be(i), which binds each chunk to its position: chunks cannot
 * be reordered, dropped or spliced in from another file without failing the tag.
 * A zero-length input still produces one chunk, so an empty file authenticates.
 *
 * Blobs are read slice by slice so a multi-gigabyte upload never has to be
 * materialised in memory all at once.
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

export async function encryptFile(
  data: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ key: Uint8Array; blob: Blob }> {
  const key = randomBytes(KEY_LEN);
  const baseIv = randomBytes(BASE_IV_LEN);
  const total = data.size;
  const count = Math.max(1, Math.ceil(total / CHUNK));

  const parts: BlobPart[] = [bufferSource(MAGIC), bufferSource(baseIv)];
  for (let i = 0; i < count; i++) {
    const start = i * CHUNK;
    const end = Math.min(start + CHUNK, total);
    const plaintext = new Uint8Array(await data.slice(start, end).arrayBuffer());
    const ct = await gcmEncrypt(key, concat(baseIv, u32be(i)), plaintext, FILE_AAD);
    parts.push(bufferSource(u32be(ct.length)), bufferSource(ct));
    onProgress?.(end, total);
  }
  return { key, blob: new Blob(parts) };
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

  const parts: BlobPart[] = [];
  let done = 0;
  for (const [i, span] of spans.entries()) {
    const ct = new Uint8Array(await blob.slice(span.start, span.start + span.len).arrayBuffer());
    let plaintext: Uint8Array;
    try {
      plaintext = await gcmDecrypt(key, concat(baseIv, u32be(i)), ct, FILE_AAD);
    } catch {
      throw new DecryptError("file: chunk failed to authenticate");
    }
    parts.push(bufferSource(plaintext));
    done += plaintext.length;
    onProgress?.(done, total);
  }
  return new Blob(parts);
}
