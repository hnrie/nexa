import { createPublicKey, verify } from "node:crypto";
import { net } from "electron";
import { RELEASE_PUBLIC_KEY } from "./releaseKey";

const FEEDS = new Set(["signed-latest.yml", "signed-latest-linux.yml", "signed-latest-mac.yml"]);
export function signedReleaseBytes(feed: string, body: Uint8Array): Buffer {
  if (!FEEDS.has(feed)) throw new Error("unknown update feed");
  return Buffer.concat([Buffer.from(`nexa-desktop-update/v1\0${feed}\0`, "utf8"), body]);
}

export function verifyRelease(feed: string, body: Uint8Array, signature: string, publicKey = RELEASE_PUBLIC_KEY): void {
  const value = signature.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(value) || !verify(null, signedReleaseBytes(feed, body), createPublicKey(publicKey), Buffer.from(value, "base64")))
    throw new Error("the update manifest has no valid release signature");
}

async function boundedBody(res: Response, maximum: number): Promise<Buffer> {
  if (!res.body) throw new Error("empty update response");
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("update response too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Authenticate exact bytes before either manifest parser sees them. */
export async function fetchRelease(base: string, feed: string): Promise<string | null> {
  if (!FEEDS.has(feed)) throw new Error("unknown update feed");
  const signal = AbortSignal.timeout(60_000);
  const get = (name: string) => net.fetch(new URL(name, base).toString(), { cache: "no-store", signal });
  const res = await get(feed);
  if (res.status === 404) { await res.body?.cancel(); return null; }
  if (!res.ok) { await res.body?.cancel(); throw new Error(`update server answered ${res.status}`); }
  const body = await boundedBody(res, 1 << 20);
  const sig = await get(`${feed}.sig`);
  if (!sig.ok) { await sig.body?.cancel(); throw new Error("the update manifest signature is missing"); }
  verifyRelease(feed, body, (await boundedBody(sig, 128)).toString("ascii"));
  return body.toString("utf8");
}
