/**
 * Byte-level primitives shared by the rest of the crypto module.
 *
 * Everything here is deliberately dependency-free so it can be used from a
 * worker, the main thread, or a test runner without pulling in wasm.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Standard base64 with padding, matching Go's `encoding/base64.StdEncoding`. */
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** `btoa` chokes on very long argument lists, so feed it in slices. */
const BTOA_CHUNK = 0x8000;

/** `crypto.getRandomValues` refuses to fill more than 65536 bytes at once. */
const RANDOM_QUOTA = 65536;

export const b64 = {
  enc(u: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < u.length; i += BTOA_CHUNK) {
      bin += String.fromCharCode(...u.subarray(i, i + BTOA_CHUNK));
    }
    return btoa(bin);
  },
  dec(s: string): Uint8Array {
    if (typeof s !== "string" || !B64_RE.test(s)) throw new Error("invalid base64");
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export const utf8 = {
  enc(s: string): Uint8Array {
    return textEncoder.encode(s);
  },
  dec(u: Uint8Array): string {
    return textDecoder.decode(u);
  },
};

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("randomBytes: invalid length");
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += RANDOM_QUOTA) {
    crypto.getRandomValues(out.subarray(at, Math.min(at + RANDOM_QUOTA, n)));
  }
  return out;
}

/** Constant-time comparison. A length mismatch short-circuits to `false`. */
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError("u32be: out of range");
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

export function readU32be(u: Uint8Array, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset + 4 > u.length) {
    throw new RangeError("readU32be: out of range");
  }
  return new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(offset, false);
}
