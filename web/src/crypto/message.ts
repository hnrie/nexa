/**
 * Message envelopes.
 *
 * The server only ever sees an `Envelope`: a conversation id, an epoch, and an
 * opaque AES-256-GCM ciphertext. The channel and author are bound into the
 * additional authenticated data, so a ciphertext cannot be replayed into
 * another channel or attributed to another author.
 */

import { IV_LEN, gcmDecrypt, gcmEncrypt } from "./aes";
import { b64, randomBytes, utf8 } from "./bytes";
import { DecryptError } from "./keys";

export interface Envelope {
  v: 1;
  conv: string;
  epoch: number;
  /** base64 of the 12-byte GCM nonce. */
  iv: string;
  /** base64 of the ciphertext and tag. */
  ct: string;
}

export interface Aad {
  conv: string;
  epoch: number;
  channelId: string;
  authorId: string;
}

export interface AttachmentMeta {
  blob_id: string;
  name: string;
  type: string;
  size: number;
  w?: number;
  h?: number;
  /** base64 of the per-file AES key. */
  key: string;
  spoiler?: boolean;
  duration?: number;
  /**
   * A webhook's file: stored as it was sent, not encrypted, so it downloads
   * as it is and `key` is empty.
   */
  plain?: boolean;
  /** Alt text a webhook gave the file. */
  alt?: string;
}

export interface MessagePayload {
  t?: string;
  att?: AttachmentMeta[];
  /** A sticker reference: enough to render it without owning the pack. */
  sticker?: { id: string; blob?: string; name?: string; w?: number; h?: number; animated?: boolean; format?: string };
  embeds?: unknown[];
  flags?: number;
}

export function aadBytes(a: Aad): Uint8Array {
  return utf8.enc(`${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}`);
}

export async function encryptMessage(
  chanKey: Uint8Array,
  aad: Aad,
  payload: MessagePayload,
): Promise<Envelope> {
  const iv = randomBytes(IV_LEN);
  const ct = await gcmEncrypt(chanKey, iv, utf8.enc(JSON.stringify(payload)), aadBytes(aad));
  return { v: 1, conv: aad.conv, epoch: aad.epoch, iv: b64.enc(iv), ct: b64.enc(ct) };
}

export async function decryptMessage(
  chanKey: Uint8Array,
  env: Envelope,
  aad: Aad,
): Promise<MessagePayload> {
  if (env.v !== 1) throw new DecryptError("unsupported envelope version");

  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = b64.dec(env.iv);
    ct = b64.dec(env.ct);
  } catch {
    throw new DecryptError("malformed envelope");
  }
  if (iv.length !== IV_LEN) throw new DecryptError("malformed envelope");

  let plaintext: Uint8Array;
  try {
    plaintext = await gcmDecrypt(chanKey, iv, ct, aadBytes(aad));
  } catch {
    throw new DecryptError("message failed to decrypt");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.dec(plaintext));
  } catch {
    throw new DecryptError("malformed message payload");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DecryptError("malformed message payload");
  }
  return sanitizePayload(parsed as Obj);
}

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function sanitizeAttachment(x: unknown): AttachmentMeta | null {
  if (!isObj(x)) return null;
  const { blob_id, name, type, key, size, w, h, duration, spoiler } = x;
  if (typeof blob_id !== "string" || typeof name !== "string" || typeof type !== "string" || typeof key !== "string") return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
  const a: AttachmentMeta = { blob_id, name, type, size, key };
  if (isNum(w)) a.w = w;
  if (isNum(h)) a.h = h;
  if (isNum(duration)) a.duration = duration;
  if (typeof spoiler === "boolean") a.spoiler = spoiler;
  // a message sealed by a person holds only encrypted files, whatever it says
  return a;
}

const EMBED_STRINGS = ["url", "type", "title", "description", "site_name", "image", "video_id", "mime", "color", "invite_code"];
const EMBED_NUMBERS = ["image_w", "image_h", "member_count", "online_count"];

/**
 * Whether a link in an embed may be followed or loaded: an http(s) address,
 * or a path on this server. Anything else — javascript:, a data: page, a
 * path a browser would resolve to another host — the sender wrote to do
 * something other than show a link.
 */
export function webLink(v: string): boolean {
  if (/[\\\s\u0000-\u001f\u007f]/.test(v)) return false;
  if (v.startsWith("/")) return !v.startsWith("//");
  return /^https?:\/\//i.test(v);
}

const EMBED_LINKS = new Set(["url", "image"]);

export function sanitizeEmbed(e: Obj): Obj {
  const out: Obj = {};
  for (const k of EMBED_STRINGS) {
    const v = e[k];
    if (typeof v === "string" && (!EMBED_LINKS.has(k) || webLink(v))) out[k] = v;
  }
  for (const k of EMBED_NUMBERS) if (isNum(e[k])) out[k] = e[k];
  return out;
}

/**
 * Anyone holding the key can encrypt whatever they like, and the UI trusts
 * these fields' types while rendering, so one wrong type would crash every
 * client that shows the message. Only well-typed fields are kept, and a
 * payload that had content but none of it usable counts as undecryptable.
 */
function sanitizePayload(p: Obj): MessagePayload {
  const out: MessagePayload = {};
  if (typeof p["t"] === "string") out.t = p["t"];
  if (Array.isArray(p["att"])) {
    const att = p["att"].map(sanitizeAttachment).filter((a): a is AttachmentMeta => a !== null);
    if (att.length) out.att = att;
  }
  const st = p["sticker"];
  if (isObj(st) && typeof st["id"] === "string") {
    const sticker: NonNullable<MessagePayload["sticker"]> = { id: st["id"] };
    if (typeof st["blob"] === "string") sticker.blob = st["blob"];
    if (typeof st["name"] === "string") sticker.name = st["name"];
    if (isNum(st["w"])) sticker.w = st["w"];
    if (isNum(st["h"])) sticker.h = st["h"];
    if (typeof st["animated"] === "boolean") sticker.animated = st["animated"];
    if (typeof st["format"] === "string") sticker.format = st["format"];
    out.sticker = sticker;
  }
  if (Array.isArray(p["embeds"])) {
    const embeds = p["embeds"].filter((e): e is Obj => isObj(e) && typeof e["url"] === "string").map(sanitizeEmbed).filter((e) => typeof e["url"] === "string");
    if (embeds.length) out.embeds = embeds;
  }
  if (isNum(p["flags"])) out.flags = p["flags"];
  const hadContent = p["t"] !== undefined || p["att"] !== undefined || p["sticker"] !== undefined || p["embeds"] !== undefined;
  if (hadContent && out.t === undefined && !out.att && !out.sticker && !out.embeds) {
    throw new DecryptError("malformed message payload");
  }
  return out;
}

export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e["v"] === 1 &&
    typeof e["conv"] === "string" &&
    typeof e["epoch"] === "number" &&
    Number.isInteger(e["epoch"]) &&
    typeof e["iv"] === "string" &&
    typeof e["ct"] === "string"
  );
}
