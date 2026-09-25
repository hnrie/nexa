// @vitest-environment jsdom
import type { AttachmentMeta } from "@/crypto/message";

const fetched = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/api/channels", () => ({
  attachmentUrl: (id: string) => `/media/${id}`,
  channels: {
    downloadAttachment: vi.fn(async () => {
      fetched.count += 1;
      return new Blob([]);
    }),
  },
}));

import { inPageMax, saveAttachment } from "./download";

const MB = 1024 * 1024;
const big = (size: number): AttachmentMeta => ({ blob_id: "b1", key: "", name: "film.mov", size, type: "video/quicktime" }) as AttachmentMeta;

function setNavigator(props: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(navigator, k, { value: v, configurable: true });
}

afterEach(() => {
  for (const k of ["deviceMemory", "standalone", "serviceWorker", "userAgent", "maxTouchPoints"]) delete (navigator as unknown as Record<string, unknown>)[k];
  fetched.count = 0;
});

describe("how much a tab decrypts in the page to save a file", () => {
  it("follows the memory the browser says the device has", () => {
    setNavigator({ deviceMemory: 8 });
    expect(inPageMax()).toBe(1024 * MB);
    setNavigator({ deviceMemory: 2 });
    expect(inPageMax()).toBe(256 * MB);
    setNavigator({ deviceMemory: 0.5 });
    expect(inPageMax()).toBe(128 * MB);
  });

  it("takes a phone's worth on a phone that does not say, and a gigabyte on a computer", () => {
    setNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 });
    expect(inPageMax()).toBe(256 * MB);
    setNavigator({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36", maxTouchPoints: 0 });
    expect(inPageMax()).toBe(1024 * MB);
  });

  it("says a file is too large for an iPhone's home-screen app before fetching any of it", async () => {
    setNavigator({ standalone: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 });
    await expect(saveAttachment(big(700 * MB))).rejects.toThrow(/too large to save on this device/i);
    expect(fetched.count).toBe(0);
  });
});
