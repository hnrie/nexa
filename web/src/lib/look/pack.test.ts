import { describe, expect, it } from "vitest";
import { UnreadableText, byteLength, packText, unpackText } from "./pack";

// Node's own streams, as a browser has them: jsdom's Blob has no stream().
describe("text kept in the settings", () => {
  it("comes back exactly as it went in, packed when that is smaller", async () => {
    const css = `:root { --brand: #e91e63; }\n${".x { color: red; }\n".repeat(400)}`;
    const packed = await packText(css);
    expect(packed.startsWith("z1:")).toBe(true);
    expect(packed.length).toBeLessThan(css.length / 4);
    expect(await unpackText(packed)).toBe(css);
    // too short to be worth it
    expect(await packText("a{}")).toBe("t1:a{}");
    expect(await unpackText("t1:a{}")).toBe("a{}");
    expect(await unpackText("")).toBe("");
    expect(await unpackText(await packText("ünïcödé ✓ 日本"))).toBe("ünïcödé ✓ 日本");
  });

  it("says so when packed text cannot be read", async () => {
    await expect(unpackText("z1:not base64 at all!")).rejects.toBeInstanceOf(UnreadableText);
  });

  it("measures in UTF-8 bytes, which is what the limits are in", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("日本")).toBe(6);
  });
});
