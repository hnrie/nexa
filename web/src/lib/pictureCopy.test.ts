import type { AttachmentMeta } from "@/crypto/message";
import { animatedFrom, copyOf, copyWanted } from "./pictureCopy";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** The start of a PNG with these chunks, each full of zeros. */
function png(chunks: [string, number][]): Uint8Array {
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [kind, len] of chunks) out.push(...u32(len), ...ascii(kind), ...new Array<number>(len + 4).fill(0));
  return new Uint8Array(out);
}

/** A WebP whose first chunk is `kind`, with `flags` where an extended one keeps them. */
function webp(kind: string, flags = 0): Uint8Array {
  return new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(kind), 10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function avif(brands: string[]): Uint8Array {
  const size = 16 + brands.length * 4;
  return new Uint8Array([...u32(size), ...ascii("ftyp"), ...ascii(brands[0]!), 0, 0, 0, 0, ...brands.flatMap(ascii), ...u32(8), ...ascii("meta")]);
}

function padded(head: Uint8Array, size: number, name: string, type: string): File {
  const out = new Uint8Array(size);
  out.set(head);
  return new File([out], name, { type });
}

describe("animatedFrom", () => {
  it("tells a moving picture from a still one by the start of its file", () => {
    expect(animatedFrom(png([["IHDR", 13], ["IDAT", 10]]), "image/png")).toBe(false);
    expect(animatedFrom(png([["IHDR", 13], ["acTL", 8], ["IDAT", 10]]), "image/png")).toBe(true);
    // one that cannot be followed as far as its image data is left alone
    expect(animatedFrom(png([["IHDR", 13], ["iCCP", 100_000]]).slice(0, 300), "image/png")).toBe(true);
    expect(animatedFrom(webp("VP8X", 0x02), "image/webp")).toBe(true);
    expect(animatedFrom(webp("VP8X", 0x10), "image/webp")).toBe(false);
    expect(animatedFrom(webp("VP8L"), "image/webp")).toBe(false);
    expect(animatedFrom(avif(["avis", "avif", "mif1"]), "image/avif")).toBe(true);
    expect(animatedFrom(avif(["avif", "mif1", "miaf"]), "image/avif")).toBe(false);
    expect(animatedFrom(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(false);
  });
});

describe("copyWanted", () => {
  it("makes copies of big still pictures only", async () => {
    const still = png([["IHDR", 13], ["IDAT", 10]]);
    expect(await copyWanted(padded(new Uint8Array([0xff, 0xd8]), 300 * 1024, "a.jpg", "image/jpeg"))).toBe(true);
    expect(await copyWanted(padded(still, 300 * 1024, "a.png", "image/png"))).toBe(true);
    // small enough to show as it is
    expect(await copyWanted(padded(new Uint8Array([0xff, 0xd8]), 100 * 1024, "a.jpg", "image/jpeg"))).toBe(false);
    // moving, or not a kind a copy is made of
    expect(await copyWanted(padded(png([["IHDR", 13], ["acTL", 8], ["IDAT", 10]]), 300 * 1024, "a.png", "image/png"))).toBe(false);
    expect(await copyWanted(padded(new Uint8Array([0x47, 0x49, 0x46]), 300 * 1024, "a.gif", "image/gif"))).toBe(false);
    expect(await copyWanted(padded(new Uint8Array([0x3c]), 300 * 1024, "a.svg", "image/svg+xml"))).toBe(false);
  });
});

describe("copyOf", () => {
  it("turns a picture's copy into an attachment of its own", () => {
    const att: AttachmentMeta = { blob_id: "1", name: "cat.jpg", type: "image/jpeg", size: 4_000_000, key: "k", w: 4032, h: 3024, preview: { blob_id: "2", key: "k2", size: 9000, type: "image/webp", w: 1280, h: 960 } };
    expect(copyOf(att)).toEqual({ blob_id: "2", key: "k2", size: 9000, type: "image/webp", name: "cat.jpg", w: 1280, h: 960 });
    const { preview: _preview, ...plain } = att;
    expect(copyOf(plain)).toBeNull();
  });
});
