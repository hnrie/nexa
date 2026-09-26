/**
 * The front page's conversation as the server would be handed it.
 *
 * Each text is sealed with AES-GCM, the cipher a real message is sealed with
 * (crypto/message.ts), under a key made for this page view and never kept,
 * and shown nonce first as base64: what the page shows on the server's side
 * is real ciphertext rather than a picture of some. Where the
 * browser offers no WebCrypto (a page not served over HTTPS) random bytes of
 * the same length stand in, which read the same to anyone without the key.
 */

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** How much longer than its text a sealed text is: the nonce and the tag. */
export const SEAL_OVERHEAD = 12 + 16;

export async function seal(texts: string[]): Promise<string[]> {
  const bytes = texts.map((text) => new TextEncoder().encode(text));
  try {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    return await Promise.all(
      bytes.map(async (plain) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
        const out = new Uint8Array(iv.length + sealed.length);
        out.set(iv);
        out.set(sealed, iv.length);
        return base64(out);
      }),
    );
  } catch {
    return bytes.map((plain) => base64(crypto.getRandomValues(new Uint8Array(plain.length + SEAL_OVERHEAD))));
  }
}
