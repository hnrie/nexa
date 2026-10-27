import { equal, randomBytes, readU32be, utf8 } from "./bytes";
import { CHUNK, chunkCount, decryptFile, encryptChunks, encryptFile, encryptedSize, newBaseIv, newFileKey } from "./file";
import { DecryptError } from "./keys";

const HEADER = 4 + 8;
const TAG = 16;
const LEN_PREFIX = 4;

it("rejects truncation at a whole authenticated chunk when the message declares a larger file", async () => {
  const source = new Blob([new Uint8Array(CHUNK + 1)]);
  const { key, blob } = await encryptFile(source);
  const prefix = blob.slice(0, encryptedSize(CHUNK));
  await expect(decryptFile(prefix, key, undefined, source.size)).rejects.toBeInstanceOf(DecryptError);
  expect((await decryptFile(blob, key, undefined, source.size)).size).toBe(source.size);
});

/** Deterministic filler whose value varies per byte, so a misplaced chunk would show up. */
function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >>> 13) + 7) & 0xff;
  return out;
}

/** Index of the first differing byte, -1 when equal, -2 on a length mismatch. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Offsets of each chunk's ciphertext within an encrypted blob. */
function chunkSpans(enc: Uint8Array): Array<{ start: number; len: number }> {
  const spans: Array<{ start: number; len: number }> = [];
  let off = HEADER;
  while (off < enc.length) {
    const len = readU32be(enc, off);
    off += LEN_PREFIX;
    spans.push({ start: off, len });
    off += len;
  }
  return spans;
}

describe("CHUNK", () => {
  it("is 4 MiB", () => {
    expect(CHUNK).toBe(4 * 1024 * 1024);
  });
});

describe("encryptFile / decryptFile", () => {
  it("exposes a 32-byte key and the ECF1 header", async () => {
    const { key, blob } = await encryptFile(new Blob([pattern(10)]));
    expect(key.length).toBe(32);
    const enc = await bytesOf(blob);
    expect(equal(enc.subarray(0, 4), utf8.enc("ECF1"))).toBe(true);
    // 4-byte magic, 8-byte base iv, then one length-prefixed chunk.
    expect(enc.length).toBe(HEADER + LEN_PREFIX + 10 + TAG);
  });

  it("uses a fresh key and base iv per file", async () => {
    const a = await encryptFile(new Blob([pattern(64)]));
    const b = await encryptFile(new Blob([pattern(64)]));
    expect(equal(a.key, b.key)).toBe(false);
    const ea = await bytesOf(a.blob);
    const eb = await bytesOf(b.blob);
    expect(equal(ea.subarray(4, HEADER), eb.subarray(4, HEADER))).toBe(false);
    expect(equal(ea, eb)).toBe(false);
  });

  const sizes: Array<[string, number]> = [
    ["an empty file", 0],
    ["a small file", 10],
    ["exactly one chunk", CHUNK],
    ["one byte over a chunk", CHUNK + 1],
    ["a 9 MiB file", 9 * 1024 * 1024],
  ];
  for (const [label, size] of sizes) {
    it(`round trips ${label}`, async () => {
      const data = pattern(size);
      const { key, blob } = await encryptFile(new Blob([data]));
      const out = await bytesOf(await decryptFile(blob, key));
      expect(firstDiff(out, data)).toBe(-1);
    });
  }

  it("still authenticates an empty file, as a single zero-length chunk", async () => {
    const { key, blob } = await encryptFile(new Blob([]));
    expect(blob.size).toBe(HEADER + LEN_PREFIX + TAG);
    expect(chunkSpans(await bytesOf(blob)).length).toBe(1);
    expect((await decryptFile(blob, key)).size).toBe(0);
  });

  it("splits into ceil(size / CHUNK) chunks", async () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [CHUNK, 1],
      [CHUNK + 1, 2],
      [9 * 1024 * 1024, 3],
    ];
    for (const [size, want] of cases) {
      const { blob } = await encryptFile(new Blob([pattern(size)]));
      const spans = chunkSpans(await bytesOf(blob));
      expect(spans.length).toBe(want);
      expect(spans.reduce((n, s) => n + s.len - TAG, 0)).toBe(size);
    }
  });

  it("never reads the whole blob in one call while encrypting", async () => {
    const data = new Blob([pattern(CHUNK + 1)]);
    let wholeReads = 0;
    const watched = {
      size: data.size,
      slice: (start?: number, end?: number): Blob => data.slice(start, end),
      arrayBuffer: (): Promise<ArrayBuffer> => {
        wholeReads++;
        return data.arrayBuffer();
      },
    } as unknown as Blob;

    const { key, blob } = await encryptFile(watched);
    expect(wholeReads).toBe(0);
    expect((await decryptFile(blob, key)).size).toBe(CHUNK + 1);
  });

  it("reports progress monotonically up to the total", async () => {
    const size = CHUNK + 1;
    const encSeen: Array<[number, number]> = [];
    const { key, blob } = await encryptFile(new Blob([pattern(size)]), (done, total) => {
      encSeen.push([done, total]);
    });
    expect(encSeen.length).toBeGreaterThan(1);
    for (const [, total] of encSeen) expect(total).toBe(size);
    for (let i = 1; i < encSeen.length; i++) {
      expect(encSeen[i]?.[0] ?? -1).toBeGreaterThanOrEqual(encSeen[i - 1]?.[0] ?? -1);
    }
    expect(encSeen.at(-1)?.[0]).toBe(size);

    const decSeen: Array<[number, number]> = [];
    await decryptFile(blob, key, (done, total) => {
      decSeen.push([done, total]);
    });
    expect(decSeen.length).toBeGreaterThan(1);
    for (const [, total] of decSeen) expect(total).toBe(size);
    for (let i = 1; i < decSeen.length; i++) {
      expect(decSeen[i]?.[0] ?? -1).toBeGreaterThanOrEqual(decSeen[i - 1]?.[0] ?? -1);
    }
    expect(decSeen.at(-1)?.[0]).toBe(size);
  });

  it("reports progress for an empty file", async () => {
    const encSeen: Array<[number, number]> = [];
    const { key, blob } = await encryptFile(new Blob([]), (done, total) => {
      encSeen.push([done, total]);
    });
    expect(encSeen).toEqual([[0, 0]]);

    const decSeen: Array<[number, number]> = [];
    await decryptFile(blob, key, (done, total) => {
      decSeen.push([done, total]);
    });
    expect(decSeen).toEqual([[0, 0]]);
  });
});

describe("encryptedSize / encryptFrames", () => {
  it("knows the ciphertext size before encrypting", async () => {
    for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 9 * 1024 * 1024]) {
      const { blob } = await encryptFile(new Blob([pattern(size)]));
      expect(blob.size).toBe(encryptedSize(size));
    }
  });

  it("encrypts any stretch of chunks on its own, and the stretches make the whole file", async () => {
    const size = 5 * CHUNK + 5;
    const data = new Blob([pattern(size)]);
    const key = newFileKey();
    const baseIv = newBaseIv();
    expect(chunkCount(size)).toBe(6);
    const whole = await encryptChunks(data, key, baseIv, 0, 6);
    expect(whole.length).toBe(encryptedSize(size));
    const pieces = [await encryptChunks(data, key, baseIv, 0, 2), await encryptChunks(data, key, baseIv, 2, 3), await encryptChunks(data, key, baseIv, 5, 1)];
    expect(pieces.map((p) => p.length)).toEqual([HEADER + 2 * (LEN_PREFIX + CHUNK + TAG), 3 * (LEN_PREFIX + CHUNK + TAG), LEN_PREFIX + 5 + TAG]);
    const joined = new Uint8Array(await new Blob(pieces as BlobPart[]).arrayBuffer());
    expect(firstDiff(joined, whole)).toBe(-1);
    // sent again after a failure, a stretch is byte for byte what it was
    expect(firstDiff(await encryptChunks(data, key, baseIv, 2, 3), pieces[1]!)).toBe(-1);
    const out = await bytesOf(await decryptFile(new Blob([whole]), key));
    expect(firstDiff(out, pattern(size))).toBe(-1);
  });

  it("refuses chunks that are not there", async () => {
    const data = new Blob([pattern(CHUNK + 1)]);
    const key = newFileKey();
    const baseIv = newBaseIv();
    await expect(encryptChunks(data, key, baseIv, 1, 2)).rejects.toBeInstanceOf(RangeError);
    await expect(encryptChunks(data, key, baseIv, -1, 1)).rejects.toBeInstanceOf(RangeError);
    await expect(encryptChunks(data, key, baseIv, 0, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(encryptChunks(new Blob([]), key, baseIv, 0, 1)).resolves.toHaveLength(HEADER + LEN_PREFIX + TAG);
  });
});

describe("decryptFile failures", () => {
  let key: Uint8Array;
  let enc: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    // Three chunks, so "the middle chunk" really is a middle chunk.
    const out = await encryptFile(new Blob([pattern(9 * 1024 * 1024)]));
    key = out.key;
    enc = await bytesOf(out.blob);
  });

  it("rejects the wrong key", async () => {
    await expect(decryptFile(new Blob([enc]), randomBytes(32))).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a corrupted middle chunk", async () => {
    const spans = chunkSpans(enc);
    expect(spans.length).toBe(3);
    const middle = spans[1];
    if (!middle) throw new Error("expected three chunks");
    const at = middle.start + 100;
    const bad = enc.slice();
    bad[at] = (bad[at] ?? 0) ^ 0x01;
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a corrupted tag on the final chunk", async () => {
    const bad = enc.slice();
    const at = bad.length - 1;
    bad[at] = (bad[at] ?? 0) ^ 0x80;
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a corrupted base iv", async () => {
    const bad = enc.slice();
    bad[5] = (bad[5] ?? 0) ^ 0x01;
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a truncated tail", async () => {
    await expect(decryptFile(new Blob([enc.slice(0, enc.length - 1)]), key)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptFile(new Blob([enc.slice(0, enc.length - 5000)]), key)).rejects.toBeInstanceOf(DecryptError);

    // Cut inside a chunk-length prefix.
    const second = chunkSpans(enc)[1];
    if (!second) throw new Error("expected three chunks");
    await expect(decryptFile(new Blob([enc.slice(0, second.start - 2)]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a truncated or missing header", async () => {
    for (const n of [0, 1, 4, 11]) {
      await expect(decryptFile(new Blob([enc.slice(0, n)]), key)).rejects.toBeInstanceOf(DecryptError);
    }
  });

  it("rejects a header with no chunks at all", async () => {
    await expect(decryptFile(new Blob([enc.slice(0, HEADER)]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects bad magic", async () => {
    const bad = enc.slice();
    bad[3] = 0x32; // "ECF2"
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a chunk length shorter than the gcm tag", async () => {
    const bad = enc.slice(0, HEADER + LEN_PREFIX + TAG);
    bad.set([0, 0, 0, 4], HEADER);
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects a chunk length that overruns the blob", async () => {
    const bad = enc.slice();
    bad[HEADER] = 0xff;
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects chunks swapped out of order", async () => {
    const spans = chunkSpans(enc);
    const [a, b] = [spans[0], spans[1]];
    if (!a || !b || a.len !== b.len) throw new Error("expected two equal-sized chunks");
    const bad = enc.slice();
    bad.set(enc.subarray(b.start, b.start + b.len), a.start);
    bad.set(enc.subarray(a.start, a.start + a.len), b.start);
    await expect(decryptFile(new Blob([bad]), key)).rejects.toBeInstanceOf(DecryptError);
  });
});
