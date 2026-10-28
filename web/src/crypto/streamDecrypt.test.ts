import { randomBytes } from "./bytes";
import { CHUNK, encryptFile, encryptedSize } from "./file";
import { FileCorrupt, Permanent, cipherSizeOf, decryptStream, type CipherBody, type StreamOptions } from "./streamDecrypt";

function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >>> 13) + 7) & 0xff;
  return out;
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Uneven network reads, down to single bytes, so every boundary lands mid-read somewhere. */
const SPLITS = [1, 3, 11, 4096, 65536, 1_000_003];

interface Behaviour {
  /** Each connection in turn fails once it reaches this offset. */
  failAt?: number[];
  /** Each connection in turn ends cleanly, but early, at this offset. */
  endAt?: number[];
  /** Answer every request from the start, as a server that ignores Range would. */
  ignoreRange?: boolean;
}

/** Serves `enc` the way a network would, recording where each connection asked to start. */
function serve(enc: Uint8Array, behave: Behaviour = {}) {
  const opens: number[] = [];
  const fails = [...(behave.failAt ?? [])];
  const ends = [...(behave.endAt ?? [])];
  let cancelled = 0;
  const open = async (offset: number): Promise<CipherBody> => {
    opens.push(offset);
    const start = behave.ignoreRange ? 0 : offset;
    const failAt = fails.shift();
    const endAt = ends.shift();
    let at = start;
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (failAt !== undefined && at >= failAt) {
          controller.error(new TypeError("network error"));
          return;
        }
        if (at >= enc.length || (endAt !== undefined && at >= endAt)) {
          controller.close();
          return;
        }
        let end = Math.min(enc.length, at + SPLITS[n++ % SPLITS.length]!);
        if (failAt !== undefined) end = Math.min(end, Math.max(failAt, at + 1));
        if (endAt !== undefined) end = Math.min(end, Math.max(endAt, at + 1));
        controller.enqueue(enc.slice(at, end));
        at = end;
      },
      cancel() {
        cancelled += 1;
      },
    });
    return { reader: stream.getReader(), start };
  };
  return { open, opens, cancelled: () => cancelled };
}

const noWait = async (): Promise<void> => undefined;

async function drain(opts: StreamOptions): Promise<{ out: Uint8Array; largest: number }> {
  const src = decryptStream({ delay: noWait, ...opts });
  const parts: Uint8Array[] = [];
  let largest = 0;
  for (;;) {
    const chunk = await src.next();
    if (!chunk) break;
    parts.push(chunk);
    largest = Math.max(largest, chunk.length);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return { out, largest };
}

async function encrypt(size: number): Promise<{ data: Uint8Array; key: Uint8Array; enc: Uint8Array<ArrayBuffer> }> {
  const data = pattern(size);
  const { key, blob } = await encryptFile(new Blob([data]));
  return { data, key, enc: new Uint8Array(await blob.arrayBuffer()) };
}

describe("cipherSizeOf", () => {
  it("agrees with the encrypting side, up to the largest files", () => {
    for (const n of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 90 * 1024 * 1024, 15 * 1024 ** 3, 15 * 1024 ** 3 + 7]) {
      expect(cipherSizeOf(n)).toBe(encryptedSize(n));
    }
  });
});

describe("decryptStream", () => {
  for (const size of [0, 1, CHUNK, CHUNK + 1, 2 * CHUNK + 123]) {
    it(`decrypts what encryptFile made, ${size} bytes, however the reads are split`, async () => {
      const { data, key, enc } = await encrypt(size);
      expect(enc.length).toBe(cipherSizeOf(size));
      const { out, largest } = await drain({ key, size, open: serve(enc).open });
      expect(firstDiff(out, data)).toBe(-1);
      expect(largest).toBeLessThanOrEqual(CHUNK);
    });
  }

  describe("with a file of three chunks", () => {
    const size = 2 * CHUNK + 123;
    let data: Uint8Array;
    let key: Uint8Array;
    let enc: Uint8Array<ArrayBuffer>;

    beforeAll(async () => {
      ({ data, key, enc } = await encrypt(size));
    });

    it("picks a dropped connection up from the last byte that arrived", async () => {
      const net = serve(enc, { failAt: [CHUNK + 100, 2 * CHUNK + 5] });
      const { out } = await drain({ key, size, open: net.open });
      expect(firstDiff(out, data)).toBe(-1);
      expect(net.opens).toEqual([0, CHUNK + 100, 2 * CHUNK + 5]);
    });

    it("treats a connection that closes early like one that dropped", async () => {
      const net = serve(enc, { endAt: [CHUNK - 3] });
      const { out } = await drain({ key, size, open: net.open });
      expect(firstDiff(out, data)).toBe(-1);
      expect(net.opens).toEqual([0, CHUNK - 3]);
    });

    it("copes with a server that ignores the range and starts again from the top", async () => {
      const net = serve(enc, { ignoreRange: true, failAt: [CHUNK + 100] });
      const { out } = await drain({ key, size, open: net.open });
      expect(firstDiff(out, data)).toBe(-1);
      expect(net.opens).toEqual([0, CHUNK + 100]);
    });

    it("gives up after too many drops in a row", async () => {
      const net = serve(enc, { failAt: [50, 50, 50, 50] });
      const err = await drain({ key, size, open: net.open, retries: 2 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(FileCorrupt);
      expect(net.opens.length).toBe(3);
    });

    it("counts drops afresh after each chunk that gets through", async () => {
      const net = serve(enc, { failAt: [CHUNK - 10, 2 * CHUNK - 10, 3 * CHUNK - 10] });
      const { out } = await drain({ key, size, open: net.open, retries: 1 });
      expect(firstDiff(out, data)).toBe(-1);
    });

    it("does not retry a refusal", async () => {
      let calls = 0;
      const open = async (): Promise<CipherBody> => {
        calls += 1;
        throw new Permanent("download: the server answered 404");
      };
      await expect(drain({ key, size, open })).rejects.toBeInstanceOf(Permanent);
      expect(calls).toBe(1);
    });

    it("rejects the wrong key", async () => {
      await expect(drain({ key: randomBytes(32), size, open: serve(enc).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects a flipped byte in a later chunk", async () => {
      const bad = enc.slice();
      const at = CHUNK + 5000;
      bad[at] = (bad[at] ?? 0) ^ 1;
      await expect(drain({ key, size, open: serve(bad).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects chunks swapped out of order", async () => {
      const frame = 4 + CHUNK + 16;
      const bad = enc.slice();
      bad.set(enc.subarray(12 + frame, 12 + 2 * frame), 12);
      bad.set(enc.subarray(12, 12 + frame), 12 + frame);
      await expect(drain({ key, size, open: serve(bad).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects a size that does not match the file", async () => {
      await expect(drain({ key, size: size - 1, open: serve(enc).open })).rejects.toBeInstanceOf(FileCorrupt);
      await expect(drain({ key, size: size + 1, open: serve(enc).open })).rejects.toBeInstanceOf(FileCorrupt);
      await expect(drain({ key, size: size - CHUNK, open: serve(enc).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects anything after the last chunk", async () => {
      const long = new Uint8Array(enc.length + 9);
      long.set(enc);
      await expect(drain({ key, size, open: serve(long).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects a file that is not in this format", async () => {
      const bad = enc.slice();
      bad[3] = 0x32;
      await expect(drain({ key, size, open: serve(bad).open })).rejects.toBeInstanceOf(FileCorrupt);
    });

    it("rejects a size that is not a size", () => {
      expect(() => decryptStream({ key, size: -1, open: serve(enc).open })).toThrow(FileCorrupt);
      expect(() => decryptStream({ key, size: 1.5, open: serve(enc).open })).toThrow(FileCorrupt);
    });

    it("stops reading once cancelled", async () => {
      const net = serve(enc);
      const src = decryptStream({ key, size, open: net.open, delay: noWait });
      expect((await src.next())?.length).toBe(CHUNK);
      await src.cancel();
      expect(await src.next()).toBeNull();
      // Read-ahead may have reached the underlying stream's EOF already.
      expect(net.cancelled()).toBeLessThanOrEqual(1);
      expect(net.opens).toEqual([0]);
    });
  });

  it("reads one frame ahead while the consumer is idle, and cancels an active reader", async () => {
    const size = 4 * CHUNK + 123;
    const { key, enc } = await encrypt(size);
    let at = 0;
    let cancelled = false;
    const frameEnd = 12 + 2 * (4 + CHUNK + 16);
    let readAhead!: () => void;
    const ready = new Promise<void>((resolve) => { readAhead = resolve; });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const end = Math.min(enc.length, at + 65536);
        controller.enqueue(enc.slice(at, end));
        at = end;
        if (at >= frameEnd) readAhead();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const src = decryptStream({ key, size, open: async () => ({ reader: body.getReader(), start: 0 }) });
    expect((await src.next())?.length).toBe(CHUNK);
    await ready;
    expect(at).toBeLessThan(frameEnd + 65536);
    await src.cancel();
    expect(cancelled).toBe(true);
    expect(await src.next()).toBeNull();
  });
});
