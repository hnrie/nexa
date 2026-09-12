/**
 * Thin AES-256-GCM helpers over WebCrypto. Internal to the crypto module: the
 * public surface is re-exported from `index.ts`, this file is not.
 *
 * Failures are left to propagate as whatever WebCrypto throws; callers map them
 * onto `DecryptError` so a bad tag is indistinguishable from a malformed blob.
 */

const ALGO = "AES-GCM";

/** GCM nonce length in bytes. Fixed at 12, the only size worth using. */
export const IV_LEN = 12;

/** GCM authentication tag length in bytes. */
export const TAG_LEN = 16;

/**
 * WebCrypto only accepts views backed by a plain `ArrayBuffer`, while a
 * `Uint8Array` may in principle be backed by a `SharedArrayBuffer`. Re-view it
 * without copying in the common case, and copy in the shared case.
 */
export function bufferSource(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u.buffer instanceof ArrayBuffer
    ? new Uint8Array(u.buffer, u.byteOffset, u.byteLength)
    : new Uint8Array(u);
}

function importKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bufferSource(key), ALGO, false, [usage]);
}

export async function gcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const k = await importKey(key, "encrypt");
  const params: AesGcmParams = { name: ALGO, iv: bufferSource(iv), additionalData: bufferSource(aad) };
  return new Uint8Array(await crypto.subtle.encrypt(params, k, bufferSource(plaintext)));
}

export async function gcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const k = await importKey(key, "decrypt");
  const params: AesGcmParams = { name: ALGO, iv: bufferSource(iv), additionalData: bufferSource(aad) };
  return new Uint8Array(await crypto.subtle.decrypt(params, k, bufferSource(ciphertext)));
}
