/**
 * What the search index keeps of a message.
 *
 * Enough to find it (its words, who wrote it, where, when, what it carries)
 * and to show it as a result (the text, the pictures and files with the keys
 * that open them, the link previews), and nothing else: no ciphertext, no
 * reactions, no server-side attachment records. Kept short-named because a
 * busy account holds a hundred thousand of these, in memory and on disk.
 *
 * Plain data with no DOM or React in reach, so the worker can use it.
 */
import type { AttachmentMeta, MessagePayload } from "@/crypto/message";
import type { DecryptedMessage } from "@/lib/decrypt";
import type { HasKind } from "@/lib/search";
import { hookText } from "@/lib/webhookMessage";

/** A link preview as the message carries it, trimmed to what a result shows. */
export interface LinkPreview {
  url: string;
  type?: string;
  title?: string;
  site?: string;
  description?: string;
  image?: string;
  w?: number;
  h?: number;
  mime?: string;
}

export interface SearchDoc {
  id: string;
  /** The channel. */
  c: string;
  /** The author. */
  a: string;
  /** When it was sent, in milliseconds. */
  ts: number;
  /** When it was last edited; a copy with a different one has changed. */
  ed: number | null;
  /** The message as its author wrote it (markdown), or "". */
  t: string;
  /** The message's flags; bit 1 is pinned. */
  fl: number;
  /** The people it mentions. */
  mn?: string[];
  /** It mentions everyone. */
  ev?: boolean;
  att?: AttachmentMeta[];
  emb?: LinkPreview[];
  st?: MessagePayload["sticker"];
  /** A webhook's message: the name it was sent as, and the words in its embeds, components and poll. */
  hn?: string;
  hx?: string;
}

export const PINNED = 1;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function preview(e: unknown): LinkPreview | null {
  if (typeof e !== "object" || e === null) return null;
  const r = e as Record<string, unknown>;
  const url = str(r["url"]);
  if (!url) return null;
  const out: LinkPreview = { url };
  const put = <K extends keyof LinkPreview>(k: K, v: LinkPreview[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  put("type", str(r["type"]));
  put("title", str(r["title"]));
  put("site", str(r["site_name"]));
  put("description", str(r["description"])?.slice(0, 300));
  put("image", str(r["image"]));
  put("w", num(r["image_w"]));
  put("h", num(r["image_h"]));
  put("mime", str(r["mime"]));
  return out;
}

/**
 * The index's copy of a decrypted message, or null for one that has nothing
 * to find: a line the app writes itself (a join, a call, a pin), or a message
 * this device cannot read.
 */
export function toDoc(m: DecryptedMessage): SearchDoc | null {
  if (m.type.startsWith("system_") || !m.payload) return null;
  const p = m.payload;
  const doc: SearchDoc = { id: m.id, c: m.channel_id, a: m.author_id, ts: m.created_at, ed: m.edited_at ?? null, t: p.t ?? "", fl: m.flags ?? 0 };
  if (m.mentions?.length) doc.mn = [...m.mentions];
  if (m.mention_everyone) doc.ev = true;
  if (p.att?.length) doc.att = p.att.map((a) => ({ ...a }));
  const emb = (p.embeds ?? []).map(preview).filter((e): e is LinkPreview => e !== null);
  if (emb.length) doc.emb = emb;
  if (p.sticker) doc.st = { ...p.sticker };
  if (m.hook) {
    doc.hn = m.hook.name;
    // the content is already t; what is left is the rest of what it says
    const rest = hookText({ ...m.hook, content: "" });
    if (rest) doc.hx = rest.slice(0, 8000);
    const links = m.hook.link_embeds.map(preview).filter((e): e is LinkPreview => e !== null);
    if (links.length) doc.emb = [...(doc.emb ?? []), ...links];
  }
  return doc;
}

/**
 * Everything a search term can be found in: the message, and the names of its
 * files, its sticker and the pages it links to. "notes" finds the file called
 * notes-for-the-meeting.txt whatever the message around it said.
 */
export function searchableText(d: SearchDoc): string {
  const extra: string[] = [];
  if (d.hn) extra.push(d.hn);
  if (d.hx) extra.push(d.hx);
  for (const a of d.att ?? []) extra.push(a.name);
  if (d.st?.name) extra.push(d.st.name);
  for (const e of d.emb ?? []) {
    if (e.title) extra.push(e.title);
    if (e.site) extra.push(e.site);
  }
  return extra.length ? `${d.t}\n${extra.join("\n")}` : d.t;
}

const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`]+/gi;
const TRAILING = /[.,;:!?*_~|]+$/;

/** The web addresses written in the message, each once, in order. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, "");
    if (url.length > 10 && !out.includes(url)) out.push(url);
  }
  return out;
}

const MEDIA_EMBEDS = new Set(["image", "gif", "video"]);

export function isImage(type: string): boolean {
  return type.toLowerCase().startsWith("image/");
}

export function isVideo(type: string): boolean {
  return type.toLowerCase().startsWith("video/");
}

/** One picture or clip a message carries: an uploaded file, or one it links to. */
export type MediaItem = { kind: "file"; att: AttachmentMeta } | { kind: "link"; embed: LinkPreview };

/** The message's pictures and clips, uploaded ones first. */
export function mediaOf(d: SearchDoc): MediaItem[] {
  const out: MediaItem[] = [];
  for (const a of d.att ?? []) if (isImage(a.type) || isVideo(a.type)) out.push({ kind: "file", att: a });
  for (const e of d.emb ?? []) if (e.type && MEDIA_EMBEDS.has(e.type)) out.push({ kind: "link", embed: e });
  return out;
}

/** The message's files that are not pictures or clips: documents, archives, audio. */
export function filesOf(d: SearchDoc): AttachmentMeta[] {
  return (d.att ?? []).filter((a) => !isImage(a.type) && !isVideo(a.type));
}

/** A link a message carries, with its preview where it has one. */
export interface LinkItem {
  url: string;
  preview?: LinkPreview;
}

/**
 * The message's links: every address written in it, with the preview it
 * unfurled into, and previews of pages that are not pictures. A link that
 * only brought a GIF along is media, not a link someone would go back for.
 */
export function linksOf(d: SearchDoc): LinkItem[] {
  const previews = new Map((d.emb ?? []).map((e) => [e.url, e]));
  const out: LinkItem[] = [];
  const seen = new Set<string>();
  for (const url of linksIn(d.t)) {
    const p = previews.get(url);
    if (p?.type && MEDIA_EMBEDS.has(p.type)) continue;
    seen.add(url);
    out.push(p ? { url, preview: p } : { url });
  }
  for (const e of d.emb ?? []) {
    if (seen.has(e.url) || (e.type && MEDIA_EMBEDS.has(e.type))) continue;
    seen.add(e.url);
    out.push({ url: e.url, preview: e });
  }
  return out;
}

/** Which `has:` filters a message satisfies. */
export function hasKinds(d: SearchDoc): Set<HasKind> {
  const out = new Set<HasKind>();
  for (const a of d.att ?? []) {
    out.add("file");
    if (isImage(a.type)) out.add("image");
    else if (isVideo(a.type)) out.add("video");
    else if (a.type.toLowerCase().startsWith("audio/")) out.add("audio");
  }
  for (const e of d.emb ?? []) {
    out.add("embed");
    if (e.type === "image" || e.type === "gif") out.add("image");
    if (e.type === "video") out.add("video");
  }
  if (d.st) out.add("sticker");
  if (linksIn(d.t).length > 0) out.add("link");
  return out;
}
