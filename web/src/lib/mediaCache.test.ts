import type { AttachmentMeta } from "@/crypto/message";

vi.mock("@/api/channels", () => ({
  channels: { downloadAttachment: vi.fn(() => Promise.resolve(new Blob([]))) },
}));
vi.mock("@/crypto/file", () => ({
  encryptedSize: (n: number) => n,
  // stands in for decryption: a file of the size its message claims
  decryptFile: vi.fn(),
}));

import { channels as channelsApi } from "@/api/channels";
import { decryptFile } from "@/crypto/file";
import { PRIORITY, acquire, attachmentObjectURL, cachedURL, clearMediaCache, prioritize, release, seedMedia } from "./mediaCache";

const MB = 1024 * 1024;

function att(id: string, size: number): AttachmentMeta {
  return { blob_id: id, key: "", name: id, size, type: "image/png" } as AttachmentMeta;
}

describe("mediaCache", () => {
  let n = 0;
  beforeEach(() => {
    clearMediaCache();
    vi.mocked(channelsApi.downloadAttachment).mockReset().mockImplementation(() => Promise.resolve(new Blob([])));
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

  it("fetches what is on screen before what is only near it", async () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    vi.mocked(channelsApi.downloadAttachment).mockImplementation(async (id: string) => {
      started.push(id);
      await new Promise<void>((r) => finish.push(r));
      return new Blob([]);
    });
    vi.mocked(decryptFile).mockImplementation(() => Promise.resolve(new Blob([new Uint8Array(1)])));
    const all: Promise<string>[] = [];
    for (let i = 0; i < 12; i++) all.push(attachmentObjectURL(att(`near${i}`, 1024), undefined, PRIORITY.near));
    all.push(attachmentObjectURL(att("seen", 1024), undefined, PRIORITY.visible));
    // however many the device runs at once are going; the rest wait
    const going = started.length;
    expect(going).toBeLessThan(12);
    // one of the waiting ones scrolls into view
    prioritize("near11", PRIORITY.visible);
    finish.shift()!();
    finish.shift()!();
    await vi.waitFor(() => expect(started.length).toBe(going + 2));
    expect(new Set(started.slice(going))).toEqual(new Set(["near11", "seen"]));
    while (finish.length || started.length < 13) {
      finish.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
  });

  it("shows a file this device has just sent without fetching it back", async () => {
    seedMedia("mine", new Blob([new Uint8Array(10)]), "image/png");
    const url = cachedURL("mine");
    expect(url).toMatch(/^blob:test\//);
    await expect(attachmentObjectURL(att("mine", 10))).resolves.toBe(url);
    expect(channelsApi.downloadAttachment).not.toHaveBeenCalledWith("mine", expect.anything(), expect.anything());
  });

  it("refuses to hold a URL that is no longer the cached one", () => {
    expect(acquire("missing", "blob:test/gone")).toBe(false);
  });
});
