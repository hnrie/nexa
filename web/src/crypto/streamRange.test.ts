import { CHUNK, encryptFile } from "./file";
import { ChunkCache, FileCorrupt, Permanent, parseRange, rangeSource, type RangeSourceOptions } from "./streamRange";

function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >>> 13) + 7) & 0xff;
  return out;
}

async function encrypted(plain: Uint8Array<ArrayBuffer>): Promise<{ enc: Uint8Array<ArrayBuffer>; key: Uint8Array }> {
  const { key, blob } = await encryptFile(new Blob([plain]));
  return { enc: new Uint8Array(await blob.arrayBuffer()), key };
}

/** Answers range requests from `bytes`, recording each one. */
function server(bytes: Uint8Array<ArrayBuffer>) {
  const asked: [number, number][] = [];
  const fetch = async (start: number, end: number): Promise<Uint8Array<ArrayBuffer>> => {
    asked.push([start, end]);
    return bytes.slice(start, end + 1);
  };
  return { fetch, asked };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Whether two byte arrays hold the same bytes; toEqual walks a big one far too slowly. */
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const noWait = async (): Promise<void> => undefined;
const source = (opts: RangeSourceOptions) => rangeSource({ delay: noWait, ...opts });

describe("streamRange", () => {
  it("reads any stretch of an encrypted file, across chunks and at both ends", async () => {
    const size = 3 * CHUNK + 12_345;
    const plain = pattern(size);
    const { enc, key } = await encrypted(plain);
    const src = source({ size, key, fetch: server(enc).fetch, cache: new ChunkCache(8) });
    const stretches: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, size - 1],
      [CHUNK - 1, CHUNK],
      [CHUNK, 2 * CHUNK - 1],
      [2 * CHUNK - 10, 3 * CHUNK + 10],
      [size - 1, size - 1],
      [3 * CHUNK, size - 1],
      [123_456, 5_000_000],
    ];
    for (const [start, end] of stretches) {
      const got = await readAll(src.read(start, end));
      expect(got.length).toBe(end - start + 1);
      expect(same(got, plain.subarray(start, end + 1))).toBe(true);
    }
  });

  it("fetches only the chunks a stretch covers, and the header with the first", async () => {
    const size = 3 * CHUNK + 100;
    const { enc, key } = await encrypted(pattern(size));
    const { fetch, asked } = server(enc);
    const src = source({ size, key, fetch });
    // a seek into the third chunk: its header and its frame, nothing before it
    await readAll(src.read(2 * CHUNK + 5, 2 * CHUNK + 50));
    expect(asked).toEqual([
      [0, 11],
      [12 + 2 * (4 + CHUNK + 16), 12 + 2 * (4 + CHUNK + 16) + 4 + CHUNK + 16 - 1],
    ]);
    // from the start, the header comes in the first chunk's request
    const fresh = server(enc);
    await readAll(source({ size, key, fetch: fresh.fetch }).read(0, 99));
    expect(fresh.asked).toEqual([[0, 12 + 4 + CHUNK + 16 - 1]]);
  });

  it("keeps recent chunks, so the requests a player makes around one place fetch it once", async () => {
    const size = 2 * CHUNK + 1;
    const { enc, key } = await encrypted(pattern(size));
    const { fetch, asked } = server(enc);
    const src = source({ size, key, fetch });
    // Safari asks for two bytes first, then more of the same place
    await readAll(src.read(0, 1));
    await readAll(src.read(0, 65_535));
    await readAll(src.read(1000, 2000));
    expect(asked.length).toBe(1);
  });

  it("reads ahead into the next chunk when asked to", async () => {
    const size = 3 * CHUNK;
    const { enc, key } = await encrypted(pattern(size));
    const { fetch, asked } = server(enc);
    const src = source({ size, key, fetch });
    await readAll(src.read(0, 10, true));
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.map(([s]) => s)).toEqual([0, 12 + 4 + CHUNK + 16]);
    // and does not without it
    const quiet = server(enc);
    await readAll(source({ size, key, fetch: quiet.fetch }).read(0, 10));
    await new Promise((r) => setTimeout(r, 0));
    expect(quiet.asked.length).toBe(1);
  });

  it("shares one cache between streams, holding no more than its limit", async () => {
    const size = 3 * CHUNK;
    const { enc, key } = await encrypted(pattern(size));
    const cache = new ChunkCache(2);
    const a = source({ size, key, fetch: server(enc).fetch, cache, name: "a" });
    const b = source({ size, key, fetch: server(enc).fetch, cache, name: "b" });
    await readAll(a.read(0, 10));
    await readAll(a.read(CHUNK, CHUNK + 10));
    await readAll(b.read(2 * CHUNK, 2 * CHUNK + 10));
    expect(cache.size).toBe(2);
    cache.forget("b:");
    expect(cache.size).toBe(1);
  });

  it("refuses a chunk that has been changed, and goes on reading the others", async () => {
    const size = 2 * CHUNK + 10;
    const plain = pattern(size);
    const { enc, key } = await encrypted(plain);
    const bad = enc.slice();
    const at = 12 + (4 + CHUNK + 16) + 4 + 100;
    bad[at] = bad[at]! ^ 1;
    const src = source({ size, key, fetch: server(bad).fetch });
    await expect(readAll(src.read(CHUNK, CHUNK + 5))).rejects.toBeInstanceOf(FileCorrupt);
    expect(same(await readAll(src.read(0, 5)), plain.subarray(0, 6))).toBe(true);
  });

  it("refuses a chunk whose length is not the one the file's size gives it", async () => {
    const size = CHUNK + 10;
    const { enc, key } = await encrypted(pattern(size));
    const bad = enc.slice();
    bad[15] = bad[15]! ^ 1;
    await expect(readAll(source({ size, key, fetch: server(bad).fetch }).read(0, 5))).rejects.toBeInstanceOf(FileCorrupt);
  });

  it("refuses a file that is not one of its own, or under the wrong key", async () => {
    const size = 1000;
    const { enc, key } = await encrypted(pattern(size));
    const notOurs = enc.slice();
    notOurs[0] = 0x00;
    await expect(readAll(source({ size, key, fetch: server(notOurs).fetch }).read(0, 5))).rejects.toBeInstanceOf(FileCorrupt);
    const other = new Uint8Array(32).fill(7);
    await expect(readAll(source({ size, key: other, fetch: server(enc).fetch }).read(0, 5))).rejects.toBeInstanceOf(FileCorrupt);
  });

  it("catches a file the server cut short, or a size the message did not give", async () => {
    const size = CHUNK + 500;
    const { enc, key } = await encrypted(pattern(size));
    const short = enc.slice(0, enc.length - 100);
    await expect(readAll(source({ size, key, fetch: server(short).fetch }).read(CHUNK, CHUNK + 1))).rejects.toThrow();
    // told the file is bigger than it is, the last chunk asks for bytes that are not there
    await expect(readAll(source({ size: size + 1, key, fetch: server(enc).fetch }).read(CHUNK, CHUNK + 1))).rejects.toThrow();
  });

  it("tries a dropped connection again, but not a refusal", async () => {
    const size = 2000;
    const plain = pattern(size);
    const { enc, key } = await encrypted(plain);
    let failures = 1;
    const flaky = async (start: number, end: number) => {
      if (failures-- > 0) throw new TypeError("network error");
      return enc.slice(start, end + 1);
    };
    expect(same(await readAll(source({ size, key, fetch: flaky }).read(0, size - 1)), plain)).toBe(true);
    let calls = 0;
    const refused = async () => {
      calls += 1;
      throw new Permanent("gone");
    };
    await expect(readAll(source({ size, key, fetch: refused }).read(0, 5))).rejects.toBeInstanceOf(Permanent);
    expect(calls).toBe(1);
  });

  it("passes a file sent as it is straight through", async () => {
    const size = CHUNK + 777;
    const plain = pattern(size);
    const { fetch, asked } = server(plain);
    const src = source({ size, key: null, fetch });
    expect(same(await readAll(src.read(CHUNK - 3, CHUNK + 3)), plain.subarray(CHUNK - 3, CHUNK + 4))).toBe(true);
    expect(asked).toEqual([
      [0, CHUNK - 1],
      [CHUNK, size - 1],
    ]);
  });

  it("refuses a stretch outside the file", () => {
    const src = source({ size: 10, key: null, fetch: server(new Uint8Array(10)).fetch });
    expect(() => src.read(5, 10)).toThrow(RangeError);
    expect(() => src.read(6, 5)).toThrow(RangeError);
  });
});

describe("parseRange", () => {
  it("reads the ranges a media element asks for", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99, open: true });
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1, open: false });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99, open: false });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99, open: false });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99, open: false });
  });

  it("says which cannot be met, and leaves alone what it does not read", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-4", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
});

describe("streamRange cancelled", () => {
  it("lets a chunk that lands after the player let go pass quietly", async () => {
    const size = 2 * CHUNK;
    const { enc, key } = await encrypted(pattern(size));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const failures: unknown[] = [];
    const slow = async (start: number, end: number) => {
      await gate;
      return enc.slice(start, end + 1);
    };
    const src = rangeSource({ size, key, fetch: slow, delay: async () => undefined, onFail: (e) => failures.push(e) });
    const reader = src.read(0, size - 1, true).getReader();
    const first = reader.read();
    await reader.cancel();
    release();
    expect((await first).done).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(failures).toEqual([]);
  });
});
