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

/**
 * A picture's small copy, made by its sender for the chat to show in its
 * place (lib/pictureCopy.ts): a file of its own, encrypted under its own key.
 */
export interface AttachmentPreview {
  blob_id: string;
  /** base64 of the copy's own AES key. */
  key: string;
  size: number;
  type: string;
  w: number;
  h: number;
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
  /** A big picture's small copy, shown in the chat until the picture is opened. */
  preview?: AttachmentPreview;
  /**
   * A webhook's file: stored as it was sent, not encrypted, so it downloads
   * as it is and `key` is empty.
   */
  plain?: boolean;
  /** Alt text a webhook gave the file. */
  alt?: string;
}

/** An answer's emoji: a character (its name), or one of the app's custom emoji. */
export interface PollEmoji {
  name: string;
  id?: string;
  animated?: boolean;
}

/**
 * A person's poll. Everything it says is sealed here with the rest of the
 * message; the server is told only how many answers there are, how long it
 * runs and whether more than one may be picked, which is what it needs to
 * take votes. An answer's id is its place in the list, from 1.
 */
export interface PollPayload {
  question: string;
  answers: { text: string; emoji?: PollEmoji }[];
  /** How long it runs, in hours. The server's tally has when it really closes. */
  hours: number;
  multiselect: boolean;
}

export const POLL_QUESTION_MAX = 300;
export const POLL_ANSWER_MAX = 55;
export const POLL_ANSWERS_MIN = 2;
export const POLL_ANSWERS_MAX = 10;
export const POLL_HOURS_MAX = 14 * 24;

export interface MessagePayload {
  t?: string;
  att?: AttachmentMeta[];
  /** A sticker reference: enough to render it without owning the pack. */
  sticker?: { id: string; blob?: string; name?: string; w?: number; h?: number; animated?: boolean; format?: string };
  embeds?: unknown[];
  flags?: number;
  poll?: PollPayload;
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

/** What a picture's copy may be: a still picture every browser shows, and small. */
const PREVIEW_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const PREVIEW_MAX = 2 * 1024 * 1024;

/**
 * A copy is fetched by its address and shown by its type, so both are held
 * to what a copy can be: a number, and a picture. Anything else leaves the
 * picture to show at its full size, as it did before copies.
 */
function sanitizePreview(x: unknown): AttachmentPreview | undefined {
  if (!isObj(x)) return undefined;
  const { blob_id, key, size, type, w, h } = x;
  if (typeof blob_id !== "string" || !/^\d{1,20}$/.test(blob_id) || typeof key !== "string" || typeof type !== "string" || !PREVIEW_TYPES.has(type)) return undefined;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > PREVIEW_MAX) return undefined;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return undefined;
  return { blob_id, key, size, type, w, h };
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
  const preview = type.startsWith("image/") ? sanitizePreview(x["preview"]) : undefined;
  if (preview) a.preview = preview;
  // a message sealed by a person holds only encrypted files, whatever it says
  return a;
}

// Everything a link's card draws. The card's icon, author, date, playable file
// and video player were kept out of this list when they were added, so no
// message ever showed them: whatever is not here is thrown away on arrival.
const EMBED_STRINGS = ["url", "type", "title", "description", "site_name", "image", "video_id", "mime", "color", "invite_code", "author", "author_url", "icon", "media", "media_mime", "player", "player_site", "banner"];
const EMBED_NUMBERS = ["image_w", "image_h", "member_count", "online_count", "published_at", "media_w", "media_h"];
/** Fields that only mean something as one of a few words. */
const EMBED_CHOICES: Record<string, readonly string[]> = { media_kind: ["video", "audio"], image_layout: ["large", "thumbnail"] };

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

/**
 * The fields that are addresses. Pictures and files still only load through
 * this server (lib/mediaLinks), and a player only opens for the sites the card
 * allows (Embeds); this keeps anything but a web address out of them at all.
 */
const EMBED_LINKS = new Set(["url", "image", "author_url", "icon", "media", "player", "banner"]);

export function sanitizeEmbed(e: Obj): Obj {
  const out: Obj = {};
  for (const k of EMBED_STRINGS) {
    const v = e[k];
    if (typeof v === "string" && (!EMBED_LINKS.has(k) || webLink(v))) out[k] = v;
  }
  for (const k of EMBED_NUMBERS) if (isNum(e[k])) out[k] = e[k];
  for (const [k, allowed] of Object.entries(EMBED_CHOICES)) {
    const v = e[k];
    if (typeof v === "string" && allowed.includes(v)) out[k] = v;
  }
  return out;
}

/** At most n characters (code points, so an emoji is never cut in half). */
function cap(v: string, n: number): string {
  const chars = Array.from(v);
  return chars.length > n ? chars.slice(0, n).join("") : v;
}

function sanitizePollEmoji(x: unknown): PollEmoji | undefined {
  if (!isObj(x) || typeof x["name"] !== "string" || !x["name"]) return undefined;
  const e: PollEmoji = { name: cap(x["name"], 64) };
  if (typeof x["id"] === "string" && /^\d{1,20}$/.test(x["id"])) e.id = x["id"];
  if (x["animated"] === true) e.animated = true;
  return e;
}

/**
 * A poll as the UI can trust it: a question, 2 to 10 answers, each held to
 * the lengths the dialog allows. An answer's id is its place in the list, so
 * one that cannot be read spoils the poll rather than being skipped: the
 * answers after it would take the votes meant for the ones before.
 */
function sanitizePoll(x: unknown): PollPayload | undefined {
  if (!isObj(x) || typeof x["question"] !== "string" || !x["question"].trim() || !Array.isArray(x["answers"])) return undefined;
  const list = x["answers"];
  if (list.length < POLL_ANSWERS_MIN || list.length > POLL_ANSWERS_MAX) return undefined;
  const answers: PollPayload["answers"] = [];
  for (const a of list) {
    if (!isObj(a) || typeof a["text"] !== "string") return undefined;
    const answer: PollPayload["answers"][number] = { text: cap(a["text"], POLL_ANSWER_MAX) };
    const emoji = sanitizePollEmoji(a["emoji"]);
    if (emoji) answer.emoji = emoji;
    answers.push(answer);
  }
  const h = x["hours"];
  const hours = typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= POLL_HOURS_MAX ? h : 24;
  return { question: cap(x["question"], POLL_QUESTION_MAX), answers, hours, multiselect: x["multiselect"] === true };
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
  const poll = sanitizePoll(p["poll"]);
  if (poll) out.poll = poll;
  const hadContent = p["t"] !== undefined || p["att"] !== undefined || p["sticker"] !== undefined || p["embeds"] !== undefined || p["poll"] !== undefined;
  if (hadContent && out.t === undefined && !out.att && !out.sticker && !out.embeds && !out.poll) {
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
