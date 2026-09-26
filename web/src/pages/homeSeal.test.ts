import { SEAL_OVERHEAD, seal } from "./homeSeal";

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe("the front page's ciphertext", () => {
  it("is real AES-GCM output: a nonce, the sealed text and its tag, none of it the words", async () => {
    const texts = ["Is everyone still up for Saturday?", "Deal. I'll make a playlist", "土曜日、みんなまだ来られる？"];
    const out = await seal(texts);
    expect(out).toHaveLength(3);
    out.forEach((sealed, i) => {
      expect(sealed).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(bytesOf(sealed).length).toBe(new TextEncoder().encode(texts[i]).length + SEAL_OVERHEAD);
      expect(sealed).not.toContain(texts[i]!.slice(0, 5));
    });
  });

  it("comes out different every time, since every page view has a key of its own", async () => {
    const [a] = await seal(["the same words"]);
    const [b] = await seal(["the same words"]);
    expect(a).not.toBe(b);
  });
});
