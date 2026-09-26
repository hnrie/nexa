import { b64 } from "@/crypto/bytes";

/**
 * Text as the settings blob keeps it: deflated and in base64 when the
 * browser can, which roughly quarters CSS and JavaScript. The whole blob is
 * encrypted and uploaded again on every change to any setting (a draft being
 * typed included), so what sits in it is what every save pays for.
 */
const DEFLATED = "z1:";
const PLAIN = "t1:";

/** The size of text as UTF-8, which is what the limits are in. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function packText(text: string): Promise<string> {
  if (!text) return "";
  if (typeof CompressionStream === "undefined") return PLAIN + text;
  try {
    const packed = DEFLATED + b64.enc(await through(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));
    return packed.length < text.length + PLAIN.length ? packed : PLAIN + text;
  } catch {
    return PLAIN + text;
  }
}

/** Thrown when packed text cannot be read here: a browser with no way to inflate it. */
export class UnreadableText extends Error {}

export async function unpackText(packed: string): Promise<string> {
  if (!packed) return "";
  if (packed.startsWith(PLAIN)) return packed.slice(PLAIN.length);
  if (!packed.startsWith(DEFLATED)) return packed;
  if (typeof DecompressionStream === "undefined") throw new UnreadableText("no DecompressionStream");
  try {
    return new TextDecoder().decode(await through(b64.dec(packed.slice(DEFLATED.length)), new DecompressionStream("deflate-raw")));
  } catch {
    throw new UnreadableText("corrupt");
  }
}
