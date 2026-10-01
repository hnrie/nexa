import { sanitizeAttachment, type AttachmentMeta } from "@/crypto/message";
import { RE_FILE } from "@/markdown/parse";

/**
 * What a note is, once it is opened.
 *
 * A note is markdown, the same a message is written in, plus the files it
 * holds: each file sits on a line of its own in the text (`![name](nexa-file:id)`)
 * and `files` says what each id is. The head is what the list of notes shows
 * without opening the note: its title and its first lines, with the files
 * those lines show.
 *
 * Everything here was written by whoever last saved the note, which may be
 * someone else, so it is read as carefully as a message is: only what a note
 * can hold comes out of readHead and readBody.
 */

/** How long a note's text may be, in characters. */
export const NOTE_MAX_CHARS = 200_000;
export const NOTE_TITLE_MAX = 200;
/** How much of a note the list shows of it. */
export const NOTE_PREVIEW_CHARS = 1200;
/** How many files a note can hold; the server's limit is its blobs, which a picture takes two of. */
export const NOTE_MAX_FILES = 200;
/** How many of a preview's files ride in the head. */
const PREVIEW_FILES = 6;

export interface NoteHead {
  title: string;
  preview: string;
  files: Record<string, AttachmentMeta>;
}

export interface NoteBody {
  md: string;
  files: Record<string, AttachmentMeta>;
}

/** A note as it is edited: its title, its text and its files. */
export interface NoteDoc extends NoteBody {
  title: string;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** At most n characters (code points, so an emoji is never cut in half). */
function cap(v: string, n: number): string {
  if (v.length <= n) return v;
  const chars = Array.from(v);
  return chars.length > n ? chars.slice(0, n).join("") : v;
}

function readFiles(x: unknown, max: number): Record<string, AttachmentMeta> {
  const out: Record<string, AttachmentMeta> = {};
  if (!isObj(x)) return out;
  let n = 0;
  for (const [id, raw] of Object.entries(x)) {
    if (n >= max) break;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
    const meta = sanitizeAttachment(raw);
    // a note's files are sealed like a message's: one that says it is not is not shown
    if (!meta || !/^\d{1,20}$/.test(meta.blob_id) || !meta.key) continue;
    out[id] = meta;
    n += 1;
  }
  return out;
}

export function readHead(x: unknown): NoteHead {
  if (!isObj(x)) return { title: "", preview: "", files: {} };
  return {
    title: typeof x["title"] === "string" ? cap(x["title"].replace(/\s+/g, " ").trim(), NOTE_TITLE_MAX) : "",
    preview: typeof x["preview"] === "string" ? cap(x["preview"], NOTE_PREVIEW_CHARS * 2) : "",
    files: readFiles(x["files"], PREVIEW_FILES),
  };
}

export function readBody(x: unknown): NoteBody {
  if (!isObj(x)) return { md: "", files: {} };
  return { md: typeof x["md"] === "string" ? cap(x["md"], NOTE_MAX_CHARS) : "", files: readFiles(x["files"], NOTE_MAX_FILES) };
}

/** Each line of a note's text with the id of the file it is, or null. A file line inside a code block is code. */
function fileLines(md: string): { line: string; file: string | null }[] {
  const out: { line: string; file: string | null }[] = [];
  let fence: string | null = null;
  for (const raw of md.split("\n")) {
    // inside a callout a line starts with "> "
    const line = raw.replace(/^(?:> ?)+/, "");
    const mark = /^(`{3,})/.exec(line.trimStart());
    if (mark) {
      if (fence === null) fence = mark[1]!;
      else if (mark[1]!.length >= fence.length && line.trim() === mark[1]) fence = null;
      out.push({ line: raw, file: null });
      continue;
    }
    const m = fence === null && line.startsWith("![") ? RE_FILE.exec(line) : null;
    out.push({ line: raw, file: m?.[2] ?? null });
  }
  return out;
}

/** The ids of the files a note's text shows, in order, each once. */
export function fileIds(md: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { file } of fileLines(md)) {
    if (file && !seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

/** A note's text without the lines that show the files named. */
export function withoutFiles(md: string, ids: Set<string>): string {
  if (ids.size === 0) return md;
  return fileLines(md)
    .filter(({ file }) => !file || !ids.has(file))
    .map(({ line }) => line)
    .join("\n");
}

/** A note's body with only the files its text still shows. */
export function pruned(doc: NoteBody): NoteBody {
  const files: Record<string, AttachmentMeta> = {};
  for (const id of fileIds(doc.md)) {
    const meta = doc.files[id];
    if (meta) files[id] = meta;
  }
  return { md: doc.md, files };
}

/** The blobs a note holds on the server: each file, and a picture's small copy beside it. */
export function blobIds(doc: NoteBody): string[] {
  const out = new Set<string>();
  for (const id of fileIds(doc.md)) {
    const meta = doc.files[id];
    if (!meta) continue;
    out.add(meta.blob_id);
    if (meta.preview) out.add(meta.preview.blob_id);
  }
  return [...out];
}

/** The first lines of a note, cut at the end of a line where it can be. */
function previewOf(md: string): string {
  if (md.length <= NOTE_PREVIEW_CHARS) return md;
  const cut = md.slice(0, NOTE_PREVIEW_CHARS);
  const line = cut.lastIndexOf("\n");
  // not through the middle of an emoji either
  const safe = line > NOTE_PREVIEW_CHARS / 2 ? cut.slice(0, line) : Array.from(cut).slice(0, -1).join("");
  return safe;
}

/** What the list shows of a note. */
export function headOf(doc: NoteDoc): NoteHead {
  const preview = previewOf(doc.md);
  const files: Record<string, AttachmentMeta> = {};
  for (const id of fileIds(preview).slice(0, PREVIEW_FILES)) {
    const meta = doc.files[id];
    if (meta) files[id] = meta;
  }
  return { title: cap(doc.title.replace(/\s+/g, " ").trim(), NOTE_TITLE_MAX), preview, files };
}

export function sameDoc(a: NoteDoc, b: NoteDoc): boolean {
  if (a.title !== b.title || a.md !== b.md) return false;
  const ids = fileIds(a.md);
  return ids.every((id) => a.files[id]?.blob_id === b.files[id]?.blob_id);
}
