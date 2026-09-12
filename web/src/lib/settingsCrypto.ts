import { gcmDecrypt, gcmEncrypt } from "@/crypto/aes";
import { b64, concat, randomBytes, utf8 } from "@/crypto/bytes";

const AAD = utf8.enc("settings/v1");

/** Encrypts a settings document to base64 (iv ‖ ciphertext). */
export async function encryptSettings(key: Uint8Array, doc: unknown): Promise<string> {
  const iv = randomBytes(12);
  const ct = await gcmEncrypt(key, iv, utf8.enc(JSON.stringify(doc)), AAD);
  return b64.enc(concat(iv, ct));
}

/** Decrypts a base64 settings blob; returns null when it cannot be read. */
export async function decryptSettings(key: Uint8Array, blob: string): Promise<unknown | null> {
  try {
    const raw = b64.dec(blob);
    if (raw.length < 13) return null;
    const pt = await gcmDecrypt(key, raw.slice(0, 12), raw.slice(12), AAD);
    return JSON.parse(utf8.dec(pt)) as unknown;
  } catch {
    return null;
  }
}
