import { animatedBytes, isAnimatedImage } from "./animatedImage";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function webp(flags: number | null): Uint8Array<ArrayBuffer> {
  const head = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")];
  if (flags === null) return new Uint8Array([...head, ...ascii("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return new Uint8Array([...head, ...ascii("VP8X"), 10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function chunk(kind: string, len: number): number[] {
  return [0, 0, (len >> 8) & 0xff, len & 0xff, ...ascii(kind), ...new Array<number>(len).fill(0), 0, 0, 0, 0];
}

function png(...chunks: number[][]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
}

describe("animatedBytes", () => {
  it("finds the animation flag in an extended WebP", () => {
    expect(animatedBytes("image/webp", webp(0x02))).toBe(true);
    expect(animatedBytes("image/webp", webp(0x10 | 0x02))).toBe(true);
  });

  it("takes simple and still extended WebP pictures as still", () => {
    expect(animatedBytes("image/webp", webp(null))).toBe(false);
    expect(animatedBytes("image/webp", webp(0x10))).toBe(false);
    expect(animatedBytes("image/webp", new Uint8Array(4))).toBe(false);
  });

  it("finds an acTL chunk before the image data of a PNG", () => {
    expect(animatedBytes("image/png", png(chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT", 20)))).toBe(true);
    expect(animatedBytes("image/png", png(chunk("IHDR", 13), chunk("IDAT", 20), chunk("acTL", 8)))).toBe(false);
    expect(animatedBytes("image/png", png(chunk("IHDR", 13), chunk("tEXt", 300), chunk("IDAT", 20)))).toBe(false);
  });

  it("takes GIFs as animated and other pictures as still", () => {
    expect(animatedBytes("image/gif", new Uint8Array())).toBe(true);
    expect(animatedBytes("image/jpeg", webp(0x02))).toBe(false);
  });
});

describe("isAnimatedImage", () => {
  it("reads the start of the file", async () => {
    expect(await isAnimatedImage(new Blob([webp(0x02)], { type: "image/webp" }))).toBe(true);
    expect(await isAnimatedImage(new Blob([webp(0x10)], { type: "image/webp" }))).toBe(false);
    expect(await isAnimatedImage(new Blob([], { type: "image/gif" }))).toBe(true);
  });
});
