import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMeta } from "@/crypto/message";
import { useSettings } from "@/stores/settings";
import { favoriteFile, isFavoriteGif, removeFavoriteGifs, toggleFavoriteGif } from "./gifFavorites";

vi.mock("./mediaCache", () => ({
  attachmentObjectURL: vi.fn(),
}));

import { attachmentObjectURL } from "./mediaCache";

const att = (blob_id: string): AttachmentMeta => ({
  blob_id,
  name: "funny.gif",
  type: "image/gif",
  size: 1234,
  w: 200,
  h: 100,
  key: "a2V5",
});

function favs() {
  return useSettings.getState().settings.favoriteGifs;
}

describe("uploaded favourites", () => {
  beforeEach(() => {
    useSettings.getState().patch({ favoriteGifs: [] });
    vi.mocked(attachmentObjectURL).mockReset();
  });

  it("saves an upload under its own key and toggles it back off", () => {
    expect(toggleFavoriteGif({ url: "attach:b1", att: att("b1") })).toBe(true);
    expect(favs()).toHaveLength(1);
    expect(favs()[0]?.att?.blob_id).toBe("b1");
    expect(isFavoriteGif("attach:b1")).toBe(true);
    expect(toggleFavoriteGif({ url: "attach:b1", att: att("b1") })).toBe(false);
    expect(favs()).toHaveLength(0);
  });

  it("keeps link and upload favourites apart", () => {
    toggleFavoriteGif({ url: "https://x/y.gif" });
    toggleFavoriteGif({ url: "attach:b1", att: att("b1") });
    expect(favs()).toHaveLength(2);
    removeFavoriteGifs(new Set(["attach:b1"]));
    expect(favs().map((f) => f.url)).toEqual(["https://x/y.gif"]);
  });

  it("resolves an upload to bytes through the attachment cache", async () => {
    vi.mocked(attachmentObjectURL).mockResolvedValue("blob:abc");
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
    try {
      const out = await favoriteFile({ url: "attach:b1", att: att("b1") });
      expect(attachmentObjectURL).toHaveBeenCalledWith(att("b1"));
      expect(out.name).toBe("funny.gif");
      expect(out.type).toBe("image/gif");
      expect(new Uint8Array(await out.blob.arrayBuffer())).toEqual(bytes);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses a favourite with no upload behind it", async () => {
    await expect(favoriteFile({ url: "https://x/y.gif" })).rejects.toThrow();
  });
});
