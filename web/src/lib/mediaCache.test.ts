import type { AttachmentMeta } from "@/crypto/message";

vi.mock("@/api/channels", () => ({
  channels: { downloadAttachment: vi.fn(() => Promise.resolve(new Blob([]))) },
}));
vi.mock("@/crypto/file", () => ({
  encryptedSize: (n: number) => n,
  // stands in for decryption: a file of the size its message claims
  decryptFile: vi.fn(),
}));

import { decryptFile } from "@/crypto/file";
import { acquire, attachmentObjectURL, cachedURL, clearMediaCache, release } from "./mediaCache";

const MB = 1024 * 1024;

function att(id: string, size: number): AttachmentMeta {
  return { blob_id: id, key: "", name: id, size, type: "image/png" } as AttachmentMeta;
}

describe("mediaCache", () => {
  let n = 0;
  beforeEach(() => {
    clearMediaCache();
    vi.mocked(decryptFile).mockImplementation((_c, _k) => Promise.resolve(new Blob([new Uint8Array(70 * MB)])));
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++n}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("stops a download on its way when the cache is cleared, and never caches it after", async () => {
    let finish: (b: Blob) => void = () => undefined;
    vi.mocked(decryptFile).mockImplementation(() => new Promise<Blob>((r) => (finish = r)));
    const p = attachmentObjectURL(att("late", 1024));
    await Promise.resolve();
    // signed out (or locked) while the file was still coming
    clearMediaCache();
    finish(new Blob([new Uint8Array(1024)]));
    await expect(p).rejects.toThrow();
    expect(cachedURL("late")).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("never revokes a URL something on screen still holds", async () => {
    const first = await attachmentObjectURL(att("a", 70 * MB));
    expect(acquire("a", first)).toBe(true);
    await attachmentObjectURL(att("b", 70 * MB));
    await attachmentObjectURL(att("c", 70 * MB));
    // over budget: the unheld older one goes, the held one stays
    expect(cachedURL("a")).toBe(first);
    expect(cachedURL("b")).toBeUndefined();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(first);
  });

  it("lets go of a URL once nothing holds it", async () => {
    const first = await attachmentObjectURL(att("a", 70 * MB));
    expect(acquire("a", first)).toBe(true);
    const second = await attachmentObjectURL(att("b", 70 * MB));
    expect(acquire("b", second)).toBe(true);
    const third = await attachmentObjectURL(att("c", 70 * MB));
    expect(acquire("c", third)).toBe(true);
    // all three on screen: over budget, but nothing can go
    expect(cachedURL("a")).toBe(first);
    release("a", first);
    expect(cachedURL("a")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  });

  it("refuses to hold a URL that is no longer the cached one", () => {
    expect(acquire("missing", "blob:test/gone")).toBe(false);
  });
});
