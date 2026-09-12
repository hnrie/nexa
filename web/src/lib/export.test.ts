import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "./export";

const enc = (s: string) => new TextEncoder().encode(s);

function u32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
}

describe("zip writer", () => {
  it("computes the standard CRC-32", () => {
    // the canonical check value for "123456789"
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("writes a readable store-only archive", () => {
    const zip = buildZip([
      { name: "a.txt", data: enc("hello") },
      { name: "dir/b.json", data: enc("{}") },
    ]);
    expect(u32(zip, 0)).toBe(0x04034b50); // first local header
    // end-of-central-directory sits in the last 22 bytes and counts both entries
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    const ev = new DataView(zip.buffer, zip.byteOffset + end, 22);
    expect(ev.getUint16(8, true)).toBe(2);
    expect(ev.getUint16(10, true)).toBe(2);
    const centralOffset = ev.getUint32(16, true);
    expect(u32(zip, centralOffset)).toBe(0x02014b50);
    // sizes are stored uncompressed, so the payload is findable verbatim
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("hello");
    expect(text).toContain("dir/b.json");
    expect(u32(zip, 18)).toBe(5); // compressed size == "hello".length
    expect(u32(zip, 22)).toBe(5); // uncompressed size
    expect(u32(zip, 14)).toBe(crc32(enc("hello")));
  });
});
