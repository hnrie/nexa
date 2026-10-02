/**
 * Any stretch of an attachment, fetched and decrypted a chunk at a time: how
 * the download worker plays a video while it downloads (download-sw.ts).
 *
 * Every chunk but the last holds CHUNK bytes and is sealed on its own, under
 * an iv that holds its position (crypto/fileChunks.ts). So where chunk i lies
 * in the ciphertext follows from the file's size, one range request fetches
 * it, and nothing comes out of it that has not passed its tag. The size comes
 * from the message, which is encrypted and signed, so a server that cuts a
 * file short or pads it is caught at the first chunk it touches.
 *
 * Like streamDecrypt.ts, whose format this shares, it belongs to the download
 * worker alone: nothing the app loads may import it (see there for why).
 */
import { AAD, BASE_IV_LEN, CHUNK, FileCorrupt, HEADER_LEN, IV_LEN, LEN_PREFIX, MAGIC, Permanent, TAG_LEN } from "./streamDecrypt";

export { FileCorrupt, Permanent };

/** Where chunk `i`'s frame (its length, then its ciphertext) starts in the encrypted file. */
const frameStart = (i: number): number => HEADER_LEN + i * (LEN_PREFIX + CHUNK + TAG_LEN);

const backoff = (n: number): Promise<void> => new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** n)));

/**
 * Decrypted chunks, the most recently used last, shared by every stream the
 * worker plays so that together they hold no more than `limit` of them.
 */
export class ChunkCache {
  private readonly map = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly limit: number) {}

  get(key: string): Promise<Uint8Array> | undefined {
    const p = this.map.get(key);
    if (p) {
      this.map.delete(key);
      this.map.set(key, p);
    }
    return p;
  }

  set(key: string, p: Promise<Uint8Array>): void {
    this.map.set(key, p);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!);
    // one that fails is not kept: the next request tries again
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
  }

  /** Lets go of every chunk of one stream. */
  forget(prefix: string): void {
    for (const key of [...this.map.keys()]) if (key.startsWith(prefix)) this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

export interface RangeSourceOptions {
  /** The plaintext size recorded in the message. */
  size: number;
  /** Fetches bytes [start, end] of the file on the server, both ends included. */
  fetch: (start: number, end: number) => Promise<Uint8Array<ArrayBuffer>>;
  /** The file key; null for a file that was sent as it is (a webhook's), which is only fetched. */
  key: Uint8Array | null;
  /** Shared with the worker's other streams; one of its own otherwise. */
  cache?: ChunkCache;
  /** This stream's name in a shared cache. */
  name?: string;
  /** How many failed fetches in a row are tried again. */
  retries?: number;
  /** The pause before attempt `n`; tests replace it. */
  delay?: (n: number) => Promise<void>;
  /** Told when a read fails, whatever reads it: the player only sees that its video stopped. */
  onFail?: (err: unknown) => void;
}

export interface RangeSource {
  readonly size: number;
  /**
   * Bytes [start, end] of the plaintext, both included, a chunk's worth at a
   * time as the stream is read. With `ahead`, each chunk read starts the next
   * one on its way: a player that asked for everything from here will want it.
   */
  read(start: number, end: number, ahead?: boolean): ReadableStream<Uint8Array>;
}

export function rangeSource(opts: RangeSourceOptions): RangeSource {
  const { size } = opts;
  if (!Number.isSafeInteger(size) || size < 0) throw new FileCorrupt("stream: the file size is not valid");
  const retries = opts.retries ?? 3;
  const delay = opts.delay ?? backoff;
  const cache = opts.cache ?? new ChunkCache(3);
  const name = `${opts.name ?? "stream"}:`;
  const count = Math.max(1, Math.ceil(size / CHUNK));
  const rawKey = opts.key ? new Uint8Array(opts.key) : null;
  let key: Promise<CryptoKey> | null = null;
  let baseIv: Promise<Uint8Array> | null = null;

  const plainLen = (i: number): number => Math.min(CHUNK, size - i * CHUNK);

  /** Exactly bytes [start, end], asked for again after a dropped connection. */
  async function fetchExactly(start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    for (let n = 0; ; n++) {
      try {
        const bytes = await opts.fetch(start, end);
        if (bytes.length !== end - start + 1) throw new Error("stream: the server sent a different stretch than was asked for");
        return bytes;
      } catch (err) {
        if (err instanceof Permanent || err instanceof FileCorrupt || n >= retries) throw err;
        await delay(n + 1);
      }
    }
  }

  function ivOf(header: Uint8Array): Uint8Array {
    if (MAGIC.some((b, i) => header[i] !== b)) throw new FileCorrupt("stream: this is not an encrypted file");
    return header.slice(MAGIC.length, HEADER_LEN);
  }

  function header(): Promise<Uint8Array> {
    if (!baseIv) {
      const p = fetchExactly(0, HEADER_LEN - 1).then(ivOf);
      baseIv = p;
      p.catch(() => {
        if (baseIv === p) baseIv = null;
      });
    }
    return baseIv;
  }

  function cryptoKey(): Promise<CryptoKey> {
    key ??= crypto.subtle.importKey("raw", rawKey!, "AES-GCM", false, ["decrypt"]).catch(() => {
      throw new FileCorrupt("stream: the file key is not usable");
    });
    return key;
  }

  async function load(i: number): Promise<Uint8Array> {
    const len = plainLen(i);
    if (len === 0 && !rawKey) return new Uint8Array(0);
    if (!rawKey) return fetchExactly(i * CHUNK, i * CHUNK + len - 1);
    const ctLen = len + TAG_LEN;
    const start = frameStart(i);
    const end = start + LEN_PREFIX + ctLen - 1;
    let iv0: Uint8Array;
    let frame: Uint8Array<ArrayBuffer>;
    if (i === 0 && !baseIv) {
      // the header comes in the same request as the first chunk, and a chunk read meanwhile waits for it
      const both = fetchExactly(0, end);
      const p = both.then((bytes) => ivOf(bytes.subarray(0, HEADER_LEN)));
      baseIv = p;
      p.catch(() => {
        if (baseIv === p) baseIv = null;
      });
      frame = (await both).subarray(HEADER_LEN);
      iv0 = await p;
    } else {
      [iv0, frame] = await Promise.all([header(), fetchExactly(start, end)]);
    }
    const prefix = ((frame[0]! << 24) | (frame[1]! << 16) | (frame[2]! << 8) | frame[3]!) >>> 0;
    // every chunk's size follows from the file's, so anything else is tampering or a broken file
    if (prefix !== ctLen) throw new FileCorrupt("stream: a chunk is the wrong size");
    const iv = new Uint8Array(IV_LEN);
    iv.set(iv0);
    new DataView(iv.buffer).setUint32(BASE_IV_LEN, i);
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, await cryptoKey(), frame.subarray(LEN_PREFIX)));
    } catch (err) {
      if (err instanceof FileCorrupt) throw err;
      throw new FileCorrupt("stream: a chunk failed to authenticate");
    }
  }

  function chunk(i: number): Promise<Uint8Array> {
    const k = name + i;
    let p = cache.get(k);
    if (!p) {
      p = load(i);
      cache.set(k, p);
    }
    return p;
  }

  function read(start: number, end: number, ahead = false): ReadableStream<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end >= size || start > end) {
      throw new RangeError("stream: no such stretch");
    }
    let at = start;
    /** The player let go of it (a seek, most often) while a chunk was on its way. */
    let dropped = false;
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const i = Math.floor(at / CHUNK);
          const here = chunk(i);
          if (i + 1 < count && (ahead || (i + 1) * CHUNK <= end)) void chunk(i + 1).catch(() => undefined);
          let plain: Uint8Array;
          try {
            plain = await here;
          } catch (err) {
            if (dropped) return;
            opts.onFail?.(err);
            throw err;
          }
          if (dropped) return;
          const to = Math.min(plain.length, end + 1 - i * CHUNK);
          // a copy: the cached chunk stays whole for the next request
          controller.enqueue(plain.slice(at - i * CHUNK, to));
          at = i * CHUNK + to;
          if (at > end) controller.close();
        },
        cancel() {
          dropped = true;
        },
      },
      // one chunk read ahead of the player at most; the player's own pace sets the rest
      { highWaterMark: 1 },
    );
  }

  return { size, read };
}

/**
 * The stretch a Range header asks for in a file of `size` bytes, both ends
 * included, and whether it ran to the end of the file. Null means the whole
 * file: no header, or one this does not read (several ranges, say).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number; open: boolean } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // the last n bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1, open: false };
  }
  const start = Number(m[1]);
  const open = m[2] === "";
  const end = open ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end, open };
}
