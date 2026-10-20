/**
 * Messages a webhook posted.
 *
 * A webhook is a secret address a program posts to, and what it sends reaches
 * the server readable: there is no key to seal it with. So these messages are
 * the one kind that is not end-to-end encrypted, and they arrive with their
 * content in the clear, in the `webhook` field, in the shape of Discord's
 * message, embed, component and poll objects (internal/api/webhook_message.go).
 * The app says so wherever one is shown.
 *
 * An app's messages (internal/api/bot_messages.go) come the same way and in
 * the same shape, with `application_id` naming the app and, on an answer to
 * something someone used, `interaction` saying who used what. Their buttons
 * and select menus do something: the app answers them (lib/interactions).
 *
 * Everything here is read defensively: the server checked it, but the UI
 * trusts these types while drawing, and a wrong one must not crash a client.
 */
import type { UnfurlResult } from "@/api/types";
import { sanitizeEmbed, webLink, type AttachmentMeta } from "@/crypto/message";

export interface HookMedia {
  url: string;
  /** A remote picture, through this server's media proxy. */
  proxy_url?: string;
  /** One of the message's own files. */
  blob_id?: string;
  attachment_id?: string;
  width?: number;
  height?: number;
  content_type?: string;
  description?: string;
}

export interface HookEmbedAuthor {
  name: string;
  url?: string;
  proxy_icon_url?: string;
  icon_blob_id?: string;
}

export interface HookEmbedFooter {
  text: string;
  proxy_icon_url?: string;
  icon_blob_id?: string;
}

export interface HookEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface HookEmbed {
  type: string;
  title?: string;
  description?: string;
  url?: string;
  /** Milliseconds, from the embed's ISO 8601 timestamp. */
  timestamp?: number;
  color?: number;
  author?: HookEmbedAuthor;
  footer?: HookEmbedFooter;
  image?: HookMedia;
  thumbnail?: HookMedia;
  fields: HookEmbedField[];
}

export interface HookEmoji {
  id?: string;
  name?: string;
  animated?: boolean;
}

/** One component; which fields mean anything depends on `type`. */
export interface HookComponent {
  type: number;
  components: HookComponent[];
  accessory?: HookComponent;
  style?: number;
  label?: string;
  emoji?: HookEmoji;
  url?: string;
  disabled?: boolean;
  content?: string;
  media?: HookMedia;
  file?: HookMedia;
  description?: string;
  spoiler?: boolean;
  name?: string;
  size?: number;
  items: { media: HookMedia; description?: string; spoiler?: boolean }[];
  divider?: boolean;
  spacing?: number;
  accent_color?: number;
  placeholder?: string;
  /** What the app is told was used: buttons other than links, and select menus. */
  custom_id?: string;
  /** A string select menu's choices. */
  options: HookSelectOption[];
  min_values?: number;
  max_values?: number;
  /** What a person, role, mentionable or channel select menu starts with picked. */
  default_values: { id: string; type: "user" | "role" | "channel" }[];
  /** The kinds of channel a channel select menu offers (the protocol's numbers). */
  channel_types?: number[];
}

/** One choice of a select menu. */
export interface HookSelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: HookEmoji;
  default?: boolean;
}

/** What someone used that an app's message answers. */
export interface HookInteraction {
  id: string;
  /** 2 a command, 3 a button or select menu, 5 a form. */
  type: number;
  user_id: string;
  /** The command's name, with its subcommands ("config set"). */
  name?: string;
  /** 1 typed, 2 from a person's menu, 3 from a message's menu. */
  command_type?: number;
  target_user_id?: string;
  target_message_id?: string;
  /** For a followup, the message the first answer made. */
  original_response_message_id?: string;
  /** For a form's answer, what opened the form. */
  trigger?: HookInteraction;
}

/** A sticker an app sent. */
export interface HookSticker {
  id: string;
  name: string;
  blob_id: string;
  /** The file's kind as Nexa keeps it (png, apng, gif, webp, tgs, webm). */
  format?: string;
}

export interface HookPollAnswer {
  answer_id: number;
  text: string;
  emoji?: HookEmoji;
}

export interface HookPoll {
  question: string;
  answers: HookPollAnswer[];
  /** When it closes, in milliseconds. */
  expiry: number;
  allow_multiselect: boolean;
}

export interface HookAttachment {
  id: string;
  blob_id: string;
  filename: string;
  title?: string;
  description?: string;
  content_type?: string;
  size: number;
  width?: number;
  height?: number;
  spoiler?: boolean;
  duration?: number;
  /** Shown inside an embed or a component, so not listed under the message. */
  inline?: boolean;
}

export interface HookContent {
  /** Who the message says it is from. */
  name: string;
  /** Its picture: the webhook's own (an avatar blob), or one sent with the message (proxied). */
  avatar_id?: string;
  avatar_proxy_url?: string;
  /** The address the picture was sent as, to tell senders apart; it is only ever loaded through the proxy. */
  avatar_url?: string;
  content: string;
  tts: boolean;
  embeds: HookEmbed[];
  components: HookComponent[];
  poll?: HookPoll;
  attachments: HookAttachment[];
  /** Previews the server fetched for the links in the content. */
  link_embeds: UnfurlResult[];
  source?: string;
  /** The app that wrote it, for an app's message (its bot is the message's author). */
  application_id?: string;
  /** What someone used that this answers. */
  interaction?: HookInteraction;
  stickers: HookSticker[];
}

// Component types and button styles, at Discord's numbers.
export const C_ACTION_ROW = 1;
export const C_BUTTON = 2;
export const C_SECTION = 9;
export const C_TEXT = 10;
export const C_THUMBNAIL = 11;
export const C_GALLERY = 12;
export const C_FILE = 13;
export const C_SEPARATOR = 14;
export const C_CONTAINER = 17;
export const C_STRING_SELECT = 3;
export const C_USER_SELECT = 5;
export const C_ROLE_SELECT = 6;
export const C_MENTIONABLE_SELECT = 7;
export const C_CHANNEL_SELECT = 8;
export const BUTTON_PRIMARY = 1;
export const BUTTON_SECONDARY = 2;
export const BUTTON_SUCCESS = 3;
export const BUTTON_DANGER = 4;
export const BUTTON_LINK = 5;
export const BUTTON_PREMIUM = 6;

/** Whether a component is a select menu of any kind. */
export function isSelect(type: number): boolean {
  return type === C_STRING_SELECT || (type >= C_USER_SELECT && type <= C_CHANNEL_SELECT);
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const id = (x: unknown): string | undefined => (typeof x === "string" && /^\d{1,20}$/.test(x) ? x : undefined);

/** A link a reader may follow: http(s) only. */
function href(x: unknown): string | undefined {
  const s = str(x);
  return s && /^https?:\/\//i.test(s) && webLink(s) ? s : undefined;
}

/** A picture's address on this server: its media proxy, and nothing else. */
function proxied(x: unknown): string | undefined {
  const s = str(x);
  return s && s.startsWith("/media/proxy/") && webLink(s) ? s : undefined;
}

function media(x: unknown): HookMedia | undefined {
  if (!isObj(x)) return undefined;
  const url = str(x["url"]) ?? "";
  const out: HookMedia = { url };
  const p = proxied(x["proxy_url"]);
  if (p) out.proxy_url = p;
  const blob = id(x["blob_id"]);
  if (blob) out.blob_id = blob;
  const att = id(x["attachment_id"]);
  if (att) out.attachment_id = att;
  const w = num(x["width"]);
  const h = num(x["height"]);
  if (w && h && w > 0 && h > 0) {
    out.width = w;
    out.height = h;
  }
  const ct = str(x["content_type"]);
  if (ct) out.content_type = ct;
  const d = str(x["description"]);
  if (d) out.description = d;
  return out.proxy_url || out.blob_id ? out : undefined;
}

function emoji(x: unknown): HookEmoji | undefined {
  if (!isObj(x)) return undefined;
  const out: HookEmoji = {};
  const i = id(x["id"]);
  if (i) out.id = i;
  const n = str(x["name"]);
  if (n) out.name = n.slice(0, 64);
  if (x["animated"] === true) out.animated = true;
  return out.id || out.name ? out : undefined;
}

function embed(x: unknown): HookEmbed | null {
  if (!isObj(x)) return null;
  const out: HookEmbed = { type: str(x["type"]) ?? "rich", fields: [] };
  const title = str(x["title"]);
  if (title) out.title = title;
  const desc = str(x["description"]);
  if (desc) out.description = desc;
  const url = href(x["url"]);
  if (url) out.url = url;
  const ts = str(x["timestamp"]);
  if (ts) {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) out.timestamp = ms;
  }
  const color = num(x["color"]);
  if (color !== undefined && color >= 0 && color <= 0xffffff) out.color = Math.floor(color);
  const a = x["author"];
  if (isObj(a) && str(a["name"])) {
    const author: HookEmbedAuthor = { name: str(a["name"])! };
    const u = href(a["url"]);
    if (u) author.url = u;
    const icon = proxied(a["proxy_icon_url"]);
    if (icon) author.proxy_icon_url = icon;
    const blob = id(a["icon_blob_id"]);
    if (blob) author.icon_blob_id = blob;
    out.author = author;
  }
  const f = x["footer"];
  if (isObj(f) && str(f["text"])) {
    const footer: HookEmbedFooter = { text: str(f["text"])! };
    const icon = proxied(f["proxy_icon_url"]);
    if (icon) footer.proxy_icon_url = icon;
    const blob = id(f["icon_blob_id"]);
    if (blob) footer.icon_blob_id = blob;
    out.footer = footer;
  }
  const image = media(x["image"]);
  if (image) out.image = image;
  const thumb = media(x["thumbnail"]);
  if (thumb) out.thumbnail = thumb;
  if (Array.isArray(x["fields"])) {
    for (const fv of x["fields"].slice(0, 25)) {
      if (!isObj(fv)) continue;
      const name = str(fv["name"]);
      const value = str(fv["value"]);
      if (name === undefined || value === undefined) continue;
      out.fields.push({ name, value, inline: fv["inline"] === true });
    }
  }
  return out;
}

function component(x: unknown, depth: number): HookComponent | null {
  if (!isObj(x) || depth > 4) return null;
  const type = num(x["type"]);
  if (type === undefined) return null;
  const out: HookComponent = { type, components: [], items: [], options: [], default_values: [] };
  if (Array.isArray(x["components"])) {
    out.components = x["components"].slice(0, 40).map((c) => component(c, depth + 1)).filter((c): c is HookComponent => c !== null);
  }
  const acc = component(x["accessory"], depth + 1);
  if (acc) out.accessory = acc;
  const style = num(x["style"]);
  if (style !== undefined) out.style = style;
  const label = str(x["label"]);
  if (label) out.label = label.slice(0, 80);
  const e = emoji(x["emoji"]);
  if (e) out.emoji = e;
  const url = href(x["url"]);
  if (url) out.url = url;
  if (x["disabled"] === true) out.disabled = true;
  const content = str(x["content"]);
  if (content) out.content = content;
  const m = media(x["media"]);
  if (m) out.media = m;
  const file = media(x["file"]);
  if (file) out.file = file;
  const d = str(x["description"]);
  if (d) out.description = d;
  if (x["spoiler"] === true) out.spoiler = true;
  const name = str(x["name"]);
  if (name) out.name = name;
  const size = num(x["size"]);
  if (size !== undefined && size >= 0) out.size = size;
  if (Array.isArray(x["items"])) {
    for (const it of x["items"].slice(0, 10)) {
      if (!isObj(it)) continue;
      const im = media(it["media"]);
      if (!im) continue;
      const item: HookComponent["items"][number] = { media: im };
      const idesc = str(it["description"]);
      if (idesc) item.description = idesc;
      if (it["spoiler"] === true) item.spoiler = true;
      out.items.push(item);
    }
  }
  if (typeof x["divider"] === "boolean") out.divider = x["divider"];
  const spacing = num(x["spacing"]);
  if (spacing !== undefined) out.spacing = spacing;
  const accent = num(x["accent_color"]);
  if (accent !== undefined && accent >= 0 && accent <= 0xffffff) out.accent_color = accent;
  const ph = str(x["placeholder"]);
  if (ph) out.placeholder = ph.slice(0, 150);
  const cid = str(x["custom_id"]);
  if (cid) out.custom_id = cid.slice(0, 100);
  if (Array.isArray(x["options"])) {
    for (const o of x["options"].slice(0, 25)) {
      if (!isObj(o)) continue;
      const label = str(o["label"]);
      const value = str(o["value"]);
      if (label === undefined || value === undefined) continue;
      const opt: HookSelectOption = { label: label.slice(0, 100), value: value.slice(0, 100) };
      const od = str(o["description"]);
      if (od) opt.description = od.slice(0, 100);
      const oe = emoji(o["emoji"]);
      if (oe) opt.emoji = oe;
      if (o["default"] === true) opt.default = true;
      out.options.push(opt);
    }
  }
  const minV = num(x["min_values"]);
  if (minV !== undefined && minV >= 0 && minV <= 25) out.min_values = Math.floor(minV);
  const maxV = num(x["max_values"]);
  if (maxV !== undefined && maxV >= 1 && maxV <= 25) out.max_values = Math.floor(maxV);
  if (Array.isArray(x["default_values"])) {
    for (const d of x["default_values"].slice(0, 25)) {
      if (!isObj(d)) continue;
      const did = id(d["id"]);
      const dt = d["type"];
      if (did && (dt === "user" || dt === "role" || dt === "channel")) out.default_values.push({ id: did, type: dt });
    }
  }
  if (Array.isArray(x["channel_types"])) out.channel_types = x["channel_types"].filter((n): n is number => num(n) !== undefined).slice(0, 20);
  return out;
}

function interaction(x: unknown, depth = 0): HookInteraction | undefined {
  if (!isObj(x) || depth > 1) return undefined;
  const iid = id(x["id"]);
  const uid = id(x["user_id"]);
  const type = num(x["type"]);
  if (!iid || !uid || type === undefined) return undefined;
  const out: HookInteraction = { id: iid, type, user_id: uid };
  const name = str(x["name"]);
  if (name) out.name = name.slice(0, 100);
  const ct = num(x["command_type"]);
  if (ct !== undefined) out.command_type = ct;
  for (const k of ["target_user_id", "target_message_id", "original_response_message_id"] as const) {
    const v = id(x[k]);
    if (v) out[k] = v;
  }
  const trig = interaction(x["trigger"], depth + 1);
  if (trig) out.trigger = trig;
  return out;
}

function poll(x: unknown): HookPoll | undefined {
  if (!isObj(x)) return undefined;
  const q = isObj(x["question"]) ? str(x["question"]["text"]) : undefined;
  if (!q || !Array.isArray(x["answers"])) return undefined;
  const answers: HookPollAnswer[] = [];
  for (const a of x["answers"].slice(0, 10)) {
    if (!isObj(a)) continue;
    const aid = num(a["answer_id"]);
    const pm = a["poll_media"];
    if (aid === undefined || !isObj(pm)) continue;
    const answer: HookPollAnswer = { answer_id: aid, text: str(pm["text"]) ?? "" };
    const e = emoji(pm["emoji"]);
    if (e) answer.emoji = e;
    answers.push(answer);
  }
  if (!answers.length) return undefined;
  const expiry = Date.parse(str(x["expiry"]) ?? "");
  return { question: q, answers, expiry: Number.isFinite(expiry) ? expiry : 0, allow_multiselect: x["allow_multiselect"] === true };
}

function attachment(x: unknown): HookAttachment | null {
  if (!isObj(x)) return null;
  const aid = id(x["id"]);
  const blob = id(x["blob_id"]);
  const filename = str(x["filename"]);
  const size = num(x["size"]);
  if (!aid || !blob || filename === undefined || size === undefined || size < 0) return null;
  const out: HookAttachment = { id: aid, blob_id: blob, filename, size };
  for (const k of ["title", "description", "content_type"] as const) {
    const v = str(x[k]);
    if (v) out[k] = v;
  }
  const w = num(x["width"]);
  const h = num(x["height"]);
  if (w && h && w > 0 && h > 0) {
    out.width = w;
    out.height = h;
  }
  if (x["spoiler"] === true) out.spoiler = true;
  if (x["inline"] === true) out.inline = true;
  const dur = num(x["duration_secs"]);
  if (dur) out.duration = dur;
  return out;
}

/** Reads a webhook message's content, or null for anything that is not one. */
export function sanitizeHook(raw: unknown): HookContent | null {
  if (!isObj(raw)) return null;
  const out: HookContent = {
    name: (str(raw["name"]) ?? "").slice(0, 80) || "Webhook",
    content: str(raw["content"]) ?? "",
    tts: raw["tts"] === true,
    embeds: [],
    components: [],
    attachments: [],
    link_embeds: [],
    stickers: [],
  };
  const app = id(raw["application_id"]);
  if (app) out.application_id = app;
  const it = interaction(raw["interaction"]);
  if (it) out.interaction = it;
  if (Array.isArray(raw["stickers"])) {
    for (const st of raw["stickers"].slice(0, 3)) {
      if (!isObj(st)) continue;
      const sid = id(st["id"]);
      const blob = id(st["blob_id"]);
      if (!sid || !blob) continue;
      const sticker: HookSticker = { id: sid, name: (str(st["name"]) ?? "").slice(0, 30), blob_id: blob };
      const fmt = str(st["format"]);
      if (fmt && /^(png|apng|gif|webp|tgs|webm)$/.test(fmt)) sticker.format = fmt;
      out.stickers.push(sticker);
    }
  }
  const avatar = id(raw["avatar_id"]);
  if (avatar) out.avatar_id = avatar;
  const avatarProxy = proxied(raw["avatar_proxy_url"]);
  if (avatarProxy) out.avatar_proxy_url = avatarProxy;
  const avatarUrl = href(raw["avatar_url"]);
  if (avatarUrl) out.avatar_url = avatarUrl;
  if (Array.isArray(raw["embeds"])) out.embeds = raw["embeds"].slice(0, 10).map(embed).filter((e): e is HookEmbed => e !== null);
  if (Array.isArray(raw["components"])) out.components = raw["components"].slice(0, 40).map((c) => component(c, 0)).filter((c): c is HookComponent => c !== null);
  const p = poll(raw["poll"]);
  if (p) out.poll = p;
  if (Array.isArray(raw["attachments"])) out.attachments = raw["attachments"].slice(0, 10).map(attachment).filter((a): a is HookAttachment => a !== null);
  if (Array.isArray(raw["link_embeds"])) {
    out.link_embeds = raw["link_embeds"]
      .slice(0, 5)
      .filter((e): e is Obj => isObj(e) && typeof e["url"] === "string")
      .map((e) => sanitizeEmbed(e) as unknown as UnfurlResult)
      .filter((e) => typeof e.url === "string");
  }
  const source = str(raw["source"]);
  if (source) out.source = source;
  return out;
}

/** A webhook's file as the attachment views take one: downloaded as it is, never decrypted. */
export function hookAttachmentMeta(a: HookAttachment): AttachmentMeta {
  const meta: AttachmentMeta = { blob_id: a.blob_id, name: a.filename, type: a.content_type ?? "application/octet-stream", size: a.size, key: "", plain: true };
  if (a.width && a.height) {
    meta.w = a.width;
    meta.h = a.height;
  }
  if (a.spoiler) meta.spoiler = true;
  if (a.duration) meta.duration = a.duration;
  if (a.description) meta.alt = a.description;
  return meta;
}

/** The files to list under a webhook message: the ones no embed or component shows. */
export function listedAttachments(h: HookContent): AttachmentMeta[] {
  return h.attachments.filter((a) => !a.inline).map(hookAttachmentMeta);
}

/** The attachment a picture points at, as the views take one. */
export function mediaAttachment(h: HookContent, m: HookMedia): AttachmentMeta | null {
  if (!m.blob_id) return null;
  const a = h.attachments.find((x) => x.blob_id === m.blob_id);
  return a ? hookAttachmentMeta(a) : null;
}

/**
 * Everything a webhook message says in words, for search, notifications and
 * the line a reply quotes: its content, else its embeds' and components' text.
 */
export function hookText(h: HookContent): string {
  const parts: string[] = [];
  if (h.content) parts.push(h.content);
  for (const e of h.embeds) {
    for (const s of [e.author?.name, e.title, e.description, ...e.fields.flatMap((f) => [f.name, f.value]), e.footer?.text]) if (s) parts.push(s);
  }
  const walk = (list: HookComponent[]): void => {
    for (const c of list) {
      if (c.type === C_TEXT && c.content) parts.push(c.content);
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(h.components);
  if (h.poll) parts.push(h.poll.question, ...h.poll.answers.map((a) => a.text));
  return parts.join("\n");
}

/** Whether two webhook messages look like they came from the same sender, for grouping them. */
export function sameHookSender(a: HookContent | undefined, b: HookContent | undefined): boolean {
  if (!a || !b) return !a && !b;
  // an app's messages are its bot's, which the rows group by author
  if (a.application_id || b.application_id) return a.application_id === b.application_id;
  return a.name === b.name && a.avatar_id === b.avatar_id && a.avatar_url === b.avatar_url;
}

/**
 * Whether a message goes by the name and picture it was sent with: a
 * webhook's. An app's messages are its bot's, and go by the bot's name, like
 * anyone's, though their content is read here.
 */
export function namedByHook(m: { webhook_id?: string | undefined; hook?: HookContent | undefined }): boolean {
  return !!m.hook && !!m.webhook_id;
}
