/**
 * Decrypts an attachment while it downloads, one chunk at a time, so the
 * service worker can hand a file of any size straight to the browser's
 * download manager with one encrypted chunk read ahead, independent of file size.
 *
 * This file imports nothing on purpose. sw.js runs as a classic script, which
 * cannot import, and a module shared with the app would be split out into a
 * common chunk that the worker would then have to import. The format below
 * repeats crypto/file.ts; the tests run one against the other to hold the two
 * together.
 */

export const MAGIC = [0x45, 0x43, 0x46, 0x31]; // "ECF1"
export const BASE_IV_LEN = 8;
export const HEADER_LEN = MAGIC.length + BASE_IV_LEN;
export const IV_LEN = 12;
export const LEN_PREFIX = 4;
export const TAG_LEN = 16;
export const CHUNK = 4 * 1024 * 1024;
export const AAD = new TextEncoder().encode("file/v1");

/** The ciphertext size of a file of `size` bytes. */
export function cipherSizeOf(size: number): number {
  const count = Math.max(1, Math.ceil(size / CHUNK));
  return HEADER_LEN + count * (LEN_PREFIX + TAG_LEN) + size;
}

/** The file itself is wrong: fetching it again will not help. */
export class FileCorrupt extends Error {}

/** The server refused in a way that asking again will not change, such as a 404. */
export class Permanent extends Error {}

class Cancelled extends Error {}

export interface CipherBody {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Where in the ciphertext this body begins: the offset asked for, or 0 if the range was ignored. */
  start: number;
}

export interface StreamOptions {
  key: Uint8Array;
  /** The plaintext size recorded in the message. */
  size: number;
  /** Fetches the ciphertext from `offset` to the end. */
  open: (offset: number) => Promise<CipherBody>;
  /** How many dropped connections in a row are picked up again. */
  retries?: number;
  /** The pause before attempt `n`; tests replace it. */
  delay?: (n: number) => Promise<void>;
}

export interface PlainStream {
  /** The next chunk of plaintext, or null once the whole file has been produced. */
  next(): Promise<Uint8Array | null>;
  cancel(): Promise<void>;
}

const backoff = (n: number): Promise<void> => new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** n)));

export function decryptStream(opts: StreamOptions): PlainStream {
  const { size, open } = opts;
  if (!Number.isSafeInteger(size) || size < 0) throw new FileCorrupt("download: the file size is not valid");
  const retries = opts.retries ?? 5;
  const delay = opts.delay ?? backoff;
  const total = cipherSizeOf(size);
  const count = Math.max(1, Math.ceil(size / CHUNK));
  const rawKey = new Uint8Array(opts.key);
  let key: Promise<CryptoKey> | null = null;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Bytes still to throw away because the server started earlier than asked. */
  let skip = 0;
  const queue: Uint8Array[] = [];
  let buffered = 0;
  /** Ciphertext bytes taken out of the queue so far. */
  let taken = 0;
  let index = 0;
  let baseIv: Uint8Array | null = null;
  let failures = 0;
  let closed = false;
  /** One encrypted frame read ahead while the current frame is decrypted/written. */
  let ahead: Promise<Uint8Array<ArrayBuffer>> | null = null;

  const drop = (): void => {
    const r = reader;
    reader = null;
    if (r) void r.cancel().catch(() => undefined);
  };

  const close = (): void => {
    closed = true;
    drop();
    queue.length = 0;
    buffered = 0;
  };

  /** Reads until `n` bytes are queued, reconnecting from wherever the last connection stopped. */
  async function need(n: number): Promise<void> {
    while (buffered < n) {
      if (closed) throw new Cancelled("download: cancelled");
      try {
        if (!reader) {
          const at = taken + buffered;
          const body = await open(at);
          if (closed) {
            void body.reader.cancel().catch(() => undefined);
            throw new Cancelled("download: cancelled");
          }
          if (body.start > at || body.start < 0) {
            void body.reader.cancel().catch(() => undefined);
            throw new Permanent("download: the server answered from the wrong place");
          }
          reader = body.reader;
          skip = at - body.start;
        }
        const { done, value } = await reader.read();
        if (closed) throw new Cancelled("download: cancelled");
        if (done) {
          reader = null;
          throw new Error("download: the connection ended early");
        }
        let bytes = value;
        if (skip > 0) {
          if (bytes.length <= skip) {
            skip -= bytes.length;
            continue;
          }
          bytes = bytes.subarray(skip);
          skip = 0;
        }
        if (taken + buffered + bytes.length > total) throw new FileCorrupt("download: the file is longer than it should be");
        queue.push(bytes);
        buffered += bytes.length;
      } catch (err) {
        drop();
        if (closed || err instanceof Cancelled || err instanceof FileCorrupt || err instanceof Permanent) throw err;
        failures += 1;
        if (failures > retries) throw err;
        await delay(failures);
      }
    }
  }

  function take(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = queue[0]!;
      const want = n - off;
      if (head.length <= want) {
        out.set(head, off);
        off += head.length;
        queue.shift();
      } else {
        out.set(head.subarray(0, want), off);
        queue[0] = head.subarray(want);
        off += want;
      }
    }
    buffered -= n;
    taken += n;
    return out;
  }

  function cryptoKey(): Promise<CryptoKey> {
    key ??= crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]).catch(() => {
      throw new FileCorrupt("download: the file key is not usable");
    });
    return key;
  }

  async function frame(i: number): Promise<Uint8Array<ArrayBuffer>> {
    await need(LEN_PREFIX);
    const prefix = take(LEN_PREFIX);
    const len = ((prefix[0]! << 24) | (prefix[1]! << 16) | (prefix[2]! << 8) | prefix[3]!) >>> 0;
    const plainLen = Math.min(CHUNK, size - i * CHUNK);
    if (len !== plainLen + TAG_LEN) throw new FileCorrupt("download: a chunk is the wrong size");
    await need(len);
    return take(len);
  }

  async function next(): Promise<Uint8Array | null> {
    if (closed) return null;
    try {
      if (!baseIv) {
        await need(HEADER_LEN);
        const header = take(HEADER_LEN);
        if (MAGIC.some((b, i) => header[i] !== b)) throw new FileCorrupt("download: this is not an encrypted file");
        baseIv = header.slice(MAGIC.length);
      }
      // Only this read-ahead task touches the reader between calls to next().
      const ct = await (ahead ?? frame(index));
      ahead = null;
      if (closed) return null;
      failures = 0;
      if (index + 1 < count) {
        ahead = frame(index + 1);
        // Its error belongs to the next call, even if the disk is slow to ask.
        void ahead.catch(() => undefined);
      }
      const iv = new Uint8Array(IV_LEN);
      iv.set(baseIv);
      new DataView(iv.buffer).setUint32(BASE_IV_LEN, index);
      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, await cryptoKey(), ct);
      } catch (err) {
        if (err instanceof FileCorrupt) throw err;
        throw new FileCorrupt("download: a chunk failed to authenticate");
      }
      if (closed) return null;
      index += 1;
      if (index === count) {
        if (buffered > 0) throw new FileCorrupt("download: the file is longer than it should be");
        close();
      }
      return new Uint8Array(plain);
    } catch (err) {
      close();
      throw err;
    }
  }

  return {
    next,
    cancel: async () => close(),
  };
}
