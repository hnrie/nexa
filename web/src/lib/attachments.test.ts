import { channels } from "@/api/channels";
import { uploads, type UploadSession } from "@/api/uploads";
import { b64 } from "@/crypto/bytes";
import { CHUNK, decryptFile, encryptedSize } from "@/crypto/file";
import { fitsUploadLimit, setUploadLimits, uploadStaged, type Staged } from "./attachments";

const MiB = 1024 * 1024;

function pattern(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + (i >>> 13) + 7) & 0xff;
  return out;
}

function staged(data: Uint8Array<ArrayBuffer>, file?: File): Staged {
  const f = file ?? new File([data], "big.bin", { type: "application/octet-stream" });
  return { id: "f1", file: f, name: f.name, spoiler: false, preview: null, progress: 0, error: null };
}

async function same(blob: Blob, key: string, data: Uint8Array): Promise<boolean> {
  const out = new Uint8Array(await (await decryptFile(blob, b64.dec(key))).arrayBuffer());
  return out.length === data.length && out.every((b, i) => b === data[i]);
}

/** A stand-in for the server's resumable upload endpoints, holding what has landed. */
function fakeServer(piece: number) {
  let stored = new Uint8Array(0);
  let size = 0;
  const calls: Array<{ offset: number; length: number }> = [];
  const session = (): UploadSession => ({ id: "u1", size, received: stored.length, chunk_size: piece });
  const land = async (body: Blob): Promise<void> => {
    const bytes = new Uint8Array(await body.arrayBuffer());
    const next = new Uint8Array(stored.length + bytes.length);
    next.set(stored);
    next.set(bytes, stored.length);
    stored = next;
  };
  const server = {
    calls,
    cancelled: 0,
    stored: () => stored,
    /** Replace to misbehave; by default a piece lands and the server says so. */
    onChunk: async (offset: number, body: Blob): Promise<number> => {
      if (offset !== stored.length) throw new Error("409 offset_mismatch");
      await land(body);
      return stored.length;
    },
    land,
  };
  vi.spyOn(uploads, "create").mockImplementation(async (n) => {
    size = n;
    return session();
  });
  vi.spyOn(uploads, "status").mockImplementation(async () => session());
  vi.spyOn(uploads, "chunk").mockImplementation(async (_id, offset, body) => {
    calls.push({ offset, length: body.size });
    return server.onChunk(offset, body);
  });
  vi.spyOn(uploads, "finish").mockImplementation(async () => {
    if (stored.length !== size) throw new Error("400 incomplete");
    return { blob_id: "b1", size };
  });
  vi.spyOn(uploads, "cancel").mockImplementation(async () => {
    server.cancelled += 1;
  });
  return server;
}

afterEach(() => {
  vi.restoreAllMocks();
  setUploadLimits({ max: 100 * MiB, single: 90 * MiB, chunk: 32 * MiB });
});

describe("uploadStaged", () => {
  it("sends a file that fits in one request as one request", async () => {
    const data = pattern(CHUNK + 10);
    let sent: Blob | null = null;
    const single = vi.spyOn(channels, "uploadAttachment").mockImplementation(async (_ch, body) => {
      sent = body as Blob;
      return { blob_id: "b1", size: (body as Blob).size, channel_id: "c1" };
    });
    const create = vi.spyOn(uploads, "create");
    const { meta } = await uploadStaged("c1", staged(data), () => undefined);
    expect(single).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(sent!.size).toBe(encryptedSize(data.length));
    expect(await same(sent!, meta.key, data)).toBe(true);
    expect(meta.size).toBe(data.length);
  });

  describe("above the single-request limit", () => {
    const piece = 1 * MiB;
    const data = pattern(3 * CHUNK + 77);
    const total = encryptedSize(data.length);

    beforeEach(() => {
      setUploadLimits({ max: 1024 * MiB, single: 1024, chunk: piece });
      vi.spyOn(channels, "uploadAttachment").mockRejectedValue(new Error("should not be used"));
    });

    it("goes up in pieces that decrypt back to the file", async () => {
      const server = fakeServer(piece);
      const progress: number[] = [];
      const { meta, blob_id } = await uploadStaged("c1", staged(data), (p) => progress.push(p));
      expect(blob_id).toBe("b1");
      expect(uploads.create).toHaveBeenCalledWith(total);
      expect(server.calls.length).toBe(Math.ceil(total / piece));
      expect(server.calls.every((c) => c.length <= piece)).toBe(true);
      expect(await same(new Blob([server.stored()]), meta.key, data)).toBe(true);
      expect(progress.at(-1)).toBe(1);
      expect(server.cancelled).toBe(0);
    });

    it("reads the file only as far as the piece being sent", async () => {
      const server = fakeServer(piece);
      const file = new File([data], "big.bin");
      let furthest = 0;
      const watched = new Proxy(file, {
        get(target, prop) {
          if (prop === "slice") {
            return (start?: number, end?: number) => {
              furthest = Math.max(furthest, end ?? target.size);
              return target.slice(start, end);
            };
          }
          const v = Reflect.get(target, prop, target) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
      const seen: number[] = [];
      const onChunk = server.onChunk;
      server.onChunk = async (offset, body) => {
        seen.push(furthest - offset);
        return onChunk(offset, body);
      };
      await uploadStaged("c1", staged(data, watched), () => undefined);
      // never more than the piece in hand plus the chunk being encrypted into the next one
      expect(Math.max(...seen)).toBeLessThanOrEqual(piece + CHUNK);
    });

    it("sends a piece again when its request fails", async () => {
      const server = fakeServer(piece);
      const onChunk = server.onChunk;
      let n = 0;
      server.onChunk = async (offset, body) => {
        n += 1;
        if (n === 3) throw new Error("network");
        return onChunk(offset, body);
      };
      const { meta } = await uploadStaged("c1", staged(data), () => undefined);
      expect(server.calls[3]!.offset).toBe(server.calls[2]!.offset);
      expect(await same(new Blob([server.stored()]), meta.key, data)).toBe(true);
    });

    it("does not send a piece twice when only the reply was lost", async () => {
      const server = fakeServer(piece);
      let n = 0;
      server.onChunk = async (offset, body) => {
        n += 1;
        if (offset !== server.stored().length) throw new Error("409 offset_mismatch");
        await server.land(body);
        if (n === 2) throw new Error("network");
        return server.stored().length;
      };
      const { meta } = await uploadStaged("c1", staged(data), () => undefined);
      expect(server.calls.length).toBe(Math.ceil(total / piece));
      expect(server.calls[2]!.offset).toBe(2 * piece);
      expect(await same(new Blob([server.stored()]), meta.key, data)).toBe(true);
    });

    it("sends only the rest of a piece that partly landed", async () => {
      const server = fakeServer(piece);
      let n = 0;
      server.onChunk = async (offset, body) => {
        n += 1;
        if (offset !== server.stored().length) throw new Error("409 offset_mismatch");
        if (n === 2) {
          await server.land(body.slice(0, 1000));
          throw new Error("network");
        }
        await server.land(body);
        return server.stored().length;
      };
      const { meta } = await uploadStaged("c1", staged(data), () => undefined);
      expect(server.calls[2]).toEqual({ offset: piece + 1000, length: piece - 1000 });
      expect(await same(new Blob([server.stored()]), meta.key, data)).toBe(true);
    });

    it("gives up after a few failures and throws the upload away", async () => {
      const server = fakeServer(piece);
      server.onChunk = async () => {
        throw new Error("network");
      };
      await expect(uploadStaged("c1", staged(data), () => undefined)).rejects.toThrow("network");
      expect(server.calls.length).toBe(4);
      expect(server.cancelled).toBe(1);
    });
  });

  it("measures the limit on the encrypted size, as the server does", async () => {
    setUploadLimits({ max: encryptedSize(10 * MiB) });
    expect(fitsUploadLimit(10 * MiB)).toBe(true);
    expect(fitsUploadLimit(10 * MiB + 1)).toBe(false);
    const create = vi.spyOn(uploads, "create");
    const single = vi.spyOn(channels, "uploadAttachment");
    await expect(uploadStaged("c1", staged(pattern(10 * MiB + 1)), () => undefined)).rejects.toThrow("limit");
    expect(create).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
  });
});
