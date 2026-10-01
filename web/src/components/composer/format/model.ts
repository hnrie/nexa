import type { AlertKind, Align } from "@/markdown/ast";

// ---------------------------------------------------------------------------
// The formatting editor's document.
//
// A message is a flat list of blocks, the way it reads: each paragraph line,
// list item and heading is a block of its own, and a quote, callout or folded
// section is the run of neighbouring blocks that carry the same `wrap`, as in
// a word processor rather than a tree. That is what makes Enter, Backspace
// and "make this a quote" simple to get right, and it maps onto markdown's
// line-by-line blocks one to one. Text is a list of runs, each with the marks
// it carries; mentions, custom emoji, times and footnote references are
// atoms, one character wide, kept as the markdown that makes them.
//
// Everything here is pure: operations return new blocks and never change the
// ones they are given, so a snapshot for undo is just the array.
// ---------------------------------------------------------------------------

/** Formats that are on or off. */
export type Flag = "b" | "i" | "u" | "s" | "spoiler" | "code" | "mark" | "sup" | "sub";
export const FLAGS: readonly Flag[] = ["b", "i", "u", "s", "spoiler", "mark", "sup", "sub", "code"];

export interface Marks {
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  spoiler?: true;
  code?: true;
  mark?: true;
  sup?: true;
  sub?: true;
  link?: { url: string; noEmbed: boolean };
  /** A colour: text (`fg`), highlight (`bg`) or both, as palette names or #rrggbb. */
  color?: { fg: string | null; bg: string | null };
}

export type AtomKind = "user" | "channel" | "role" | "emoji" | "time" | "fnref" | "link";

export type Inline =
  | { kind: "text"; text: string; marks: Marks }
  /** Something that is one piece: `raw` is its markdown, `label` what the editor shows. */
  | { kind: "atom"; atom: AtomKind; raw: string; label: string; img?: string; marks: Marks };

export type Wrap = "quote" | AlertKind | "details" | null;

export type TextKind = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "subtext" | "li" | "note";

export interface ListInfo {
  ordered: boolean;
  task: boolean;
  checked: boolean;
  /** How many lists deep, from 0. */
  indent: number;
  /** An ordered list's first number, kept from the source; null counts on from the item before. */
  start: number | null;
}

interface Base {
  id: number;
  wrap: Wrap;
}
export interface TextBlock extends Base {
  kind: TextKind;
  content: Inline[];
  list?: ListInfo;
  /** A footnote's label. */
  label?: string;
}
export interface CodeBlock extends Base {
  kind: "code";
  lang: string;
  text: string;
}
export interface RuleBlock extends Base {
  kind: "hr";
}
export interface TableBlock extends Base {
  kind: "table";
  align: Align[];
  /** The header row first; every row has align.length cells. */
  rows: Inline[][][];
}
/**
 * A file a note holds, where it sits in the text: a picture, a video, or a
 * file to download. `file` names it among the note's files. Only a note's
 * editor makes these; a message has its attachments beside its text instead.
 */
export interface FileBlock extends Base {
  kind: "file";
  file: string;
  name: string;
}
export type Block = TextBlock | CodeBlock | RuleBlock | TableBlock | FileBlock;

/** A block with nothing to type in: a rule or a file. It is stepped over, and removed whole. */
export function isVoid(b: Block | undefined): b is RuleBlock | FileBlock {
  return !!b && (b.kind === "hr" || b.kind === "file");
}

/** A place in the document: a block, a table cell when it is in one, and an offset in characters. */
export interface Pos {
  b: number;
  cell?: [number, number];
  o: number;
}
export interface Sel {
  anchor: Pos;
  focus: Pos;
}

/** How deep lists go in the editor, the same as the parser. */
export const MAX_INDENT = 5;

let nextId = 1;
export function newId(): number {
  nextId += 1;
  return nextId;
}

export function isText(b: Block | undefined): b is TextBlock {
  return !!b && b.kind !== "code" && b.kind !== "hr" && b.kind !== "table" && b.kind !== "file";
}

export function textBlock(kind: TextKind = "p", content: Inline[] = [], wrap: Wrap = null, extra: Partial<TextBlock> = {}): TextBlock {
  return { id: newId(), kind, wrap, content, ...extra };
}

export function text(t: string, marks: Marks = {}): Inline {
  return { kind: "text", text: t, marks };
}

// ---------------------------------------------------------------------------
// marks
// ---------------------------------------------------------------------------

export function sameMarks(a: Marks, b: Marks): boolean {
  for (const f of FLAGS) if (!!a[f] !== !!b[f]) return false;
  if (!!a.link !== !!b.link || (a.link && b.link && (a.link.url !== b.link.url || a.link.noEmbed !== b.link.noEmbed))) return false;
  if (!!a.color !== !!b.color || (a.color && b.color && (a.color.fg !== b.color.fg || a.color.bg !== b.color.bg))) return false;
  return true;
}

/** Marks with a flag set or cleared, a colour or link changed; anything empty is left out. */
export function withMark(m: Marks, key: Flag, on: boolean): Marks {
  const out: Marks = { ...m };
  if (on) out[key] = true;
  else delete out[key];
  // code is literal: nothing inside it can be marked, and it keeps only what wraps it whole
  return out;
}

export function withColor(m: Marks, part: "fg" | "bg", value: string | null): Marks {
  const cur = m.color ?? { fg: null, bg: null };
  const next = { ...cur, [part]: value };
  const out: Marks = { ...m };
  if (next.fg || next.bg) out.color = next;
  else delete out.color;
  return out;
}

export function withLink(m: Marks, link: Marks["link"] | null): Marks {
  const out: Marks = { ...m };
  if (link) out.link = link;
  else delete out.link;
  return out;
}

const NO_MARKS: Marks = {};

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

export function runLength(r: Inline): number {
  return r.kind === "text" ? r.text.length : 1;
}

export function inlineLength(content: Inline[]): number {
  let n = 0;
  for (const r of content) n += runLength(r);
  return n;
}

/** Joins neighbouring text runs with the same marks and drops empty ones. */
export function normalize(content: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of content) {
    if (r.kind === "text" && r.text === "") continue;
    const last = out[out.length - 1];
    if (r.kind === "text" && last?.kind === "text" && sameMarks(last.marks, r.marks)) {
      out[out.length - 1] = { ...last, text: last.text + r.text };
      continue;
    }
    out.push(r);
  }
  return out;
}

/** The runs between two offsets. */
export function sliceInline(content: Inline[], from: number, to: number): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const r of content) {
    const len = runLength(r);
    const s = Math.max(from, at);
    const e = Math.min(to, at + len);
    if (s < e) {
      if (r.kind === "text") out.push({ ...r, text: r.text.slice(s - at, e - at) });
      else out.push(r);
    }
    at += len;
    if (at >= to) break;
  }
  return out;
}

export function spliceInline(content: Inline[], from: number, to: number, insert: Inline[]): Inline[] {
  const len = inlineLength(content);
  return normalize([...sliceInline(content, 0, from), ...insert, ...sliceInline(content, to, len)]);
}

/** Runs from `from` to `to` with their marks changed by `fn`. */
export function mapMarks(content: Inline[], from: number, to: number, fn: (m: Marks) => Marks): Inline[] {
  const len = inlineLength(content);
  const middle = sliceInline(content, from, to).map((r) => ({ ...r, marks: fn(r.marks) }) as Inline);
  return normalize([...sliceInline(content, 0, from), ...middle, ...sliceInline(content, to, len)]);
}

/** The marks typing at `offset` would take on: those of the character before it, or after it at the start. */
export function marksAt(content: Inline[], offset: number): Marks {
  let at = 0;
  let before: Marks | null = null;
  for (const r of content) {
    const len = runLength(r);
    if (offset > at && offset <= at + len) before = r.marks;
    if (offset === 0 && len > 0) return inheritable(r.marks);
    at += len;
  }
  return before ? inheritable(before) : NO_MARKS;
}

/** What carries on into newly typed text: a link and code do not spill past their end. */
function inheritable(m: Marks): Marks {
  if (!m.link && !m.code) return m;
  const out = { ...m };
  delete out.link;
  delete out.code;
  return out;
}

/** Whether every character from `from` to `to` has the flag. */
export function allHave(content: Inline[], from: number, to: number, test: (m: Marks) => boolean): boolean {
  const part = sliceInline(content, from, to);
  return part.length > 0 && part.every((r) => test(r.marks));
}

/** The text, atoms read as their markdown: what a code block made of these runs would hold. */
export function plainOf(content: Inline[]): string {
  return content.map((r) => (r.kind === "text" ? r.text : r.raw)).join("");
}

/** The extent of the link around `offset`, if there is one. */
export function linkAround(content: Inline[], offset: number): { from: number; to: number; url: string; noEmbed: boolean } | null {
  let at = 0;
  const spans: { from: number; to: number; link: NonNullable<Marks["link"]> }[] = [];
  for (const r of content) {
    const len = runLength(r);
    if (r.marks.link) {
      const last = spans[spans.length - 1];
      if (last && last.to === at && last.link.url === r.marks.link.url) last.to = at + len;
      else spans.push({ from: at, to: at + len, link: r.marks.link });
    }
    at += len;
  }
  const hit = spans.find((s) => offset >= s.from && offset <= s.to);
  return hit ? { from: hit.from, to: hit.to, url: hit.link.url, noEmbed: hit.link.noEmbed } : null;
}

// ---------------------------------------------------------------------------
// positions
// ---------------------------------------------------------------------------

export function comparePos(a: Pos, b: Pos): number {
  if (a.b !== b.b) return a.b - b.b;
  if (a.cell && b.cell) {
    if (a.cell[0] !== b.cell[0]) return a.cell[0] - b.cell[0];
    if (a.cell[1] !== b.cell[1]) return a.cell[1] - b.cell[1];
  }
  return a.o - b.o;
}

export function ordered(sel: Sel): [Pos, Pos] {
  return comparePos(sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}

export function collapsed(sel: Sel): boolean {
  return comparePos(sel.anchor, sel.focus) === 0 && sameCell(sel.anchor, sel.focus);
}

export function sameCell(a: Pos, b: Pos): boolean {
  if (a.b !== b.b) return false;
  if (!a.cell || !b.cell) return !a.cell && !b.cell;
  return a.cell[0] === b.cell[0] && a.cell[1] === b.cell[1];
}

export function caret(b: number, o: number, cell?: [number, number]): Sel {
  const p: Pos = cell ? { b, o, cell } : { b, o };
  return { anchor: p, focus: p };
}

/** How many characters a block (or one of its cells) holds, for clamping a position. */
export function sizeAt(blocks: Block[], p: Pos): number {
  const block = blocks[p.b];
  if (!block) return 0;
  if (block.kind === "table") {
    const cell = p.cell ? block.rows[p.cell[0]]?.[p.cell[1]] : undefined;
    return cell ? inlineLength(cell) : 0;
  }
  if (block.kind === "code") return block.text.length;
  if (isVoid(block)) return 0;
  return inlineLength(block.content);
}

export function clampPos(blocks: Block[], p: Pos): Pos {
  const b = Math.max(0, Math.min(blocks.length - 1, p.b));
  const block = blocks[b];
  let cell = p.cell;
  if (block?.kind === "table") {
    const r = Math.max(0, Math.min(block.rows.length - 1, cell?.[0] ?? 0));
    const c = Math.max(0, Math.min(block.align.length - 1, cell?.[1] ?? 0));
    cell = [r, c];
  } else cell = undefined;
  const q: Pos = cell ? { b, cell, o: 0 } : { b, o: 0 };
  q.o = Math.max(0, Math.min(sizeAt(blocks, q), p.o));
  return q;
}

// ---------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------

export interface Edit {
  blocks: Block[];
  sel: Sel;
}

/** The document is never empty: there is always a paragraph to type in. */
export function ensureBlock(blocks: Block[]): Block[] {
  return blocks.length ? blocks : [textBlock()];
}

/** Inserts runs at a caret in a text block or a table cell (code takes text only). */
export function insertAt(blocks: Block[], at: Pos, runs: Inline[]): Edit {
  const block = blocks[at.b];
  const out = blocks.slice();
  const add = inlineLength(runs);
  if (!block) return { blocks, sel: caret(at.b, at.o) };
  if (block.kind === "code") {
    const t = runs.map((r) => (r.kind === "text" ? r.text : r.raw)).join("");
    out[at.b] = { ...block, text: block.text.slice(0, at.o) + t + block.text.slice(at.o) };
    return { blocks: out, sel: caret(at.b, at.o + t.length) };
  }
  if (block.kind === "table" && at.cell) {
    const [r, c] = at.cell;
    const rows = block.rows.map((row) => row.slice());
    const cell = rows[r]?.[c] ?? [];
    // a cell is one line: line breaks become spaces
    const flat = runs.map((x) => (x.kind === "text" ? { ...x, text: x.text.replace(/\n/g, " ") } : x));
    rows[r]![c] = spliceInline(cell, at.o, at.o, flat);
    out[at.b] = { ...block, rows };
    return { blocks: out, sel: caret(at.b, at.o + add, [r, c]) };
  }
  if (!isText(block)) return { blocks, sel: caret(at.b, at.o) };
  out[at.b] = { ...block, content: spliceInline(block.content, at.o, at.o, runs) };
  return { blocks: out, sel: caret(at.b, at.o + add) };
}

/** What Enter makes of the block it splits: the kind the new line takes. */
function continuation(block: TextBlock): Partial<TextBlock> & { kind: TextKind } {
  if (block.kind === "li" && block.list) return { kind: "li", list: { ...block.list, checked: false, start: null } };
  return { kind: "p" };
}

/**
 * Enter. A text block splits in two, the new one carrying on the list or
 * callout; Enter on an empty list item or callout line steps out of it
 * instead, as every word processor does. In a code block it is a new line.
 */
export function splitAt(blocks: Block[], at: Pos): Edit {
  const block = blocks[at.b];
  if (!block) return { blocks, sel: caret(at.b, at.o) };
  if (block.kind === "code") return insertAt(blocks, at, [text("\n")]);
  const out = blocks.slice();
  if (isVoid(block) || block.kind === "table") {
    // a new line after it
    out.splice(at.b + 1, 0, textBlock("p", [], block.wrap));
    return { blocks: out, sel: caret(at.b + 1, 0) };
  }
  const len = inlineLength(block.content);
  if (len === 0 && block.kind === "li" && block.list) {
    // an empty item steps out one level, and out of the list from the top
    if (block.list.indent > 0) out[at.b] = { ...block, list: { ...block.list, indent: block.list.indent - 1 } };
    else out[at.b] = { ...block, kind: "p", list: undefined };
    return { blocks: out, sel: caret(at.b, 0) };
  }
  if (len === 0 && block.wrap && at.b > 0 && blocks[at.b - 1]?.wrap === block.wrap) {
    // an empty line at the end of a quote, callout or section leaves it (a section's summary line never does)
    const next = blocks[at.b + 1];
    if (!next || next.wrap !== block.wrap) {
      out[at.b] = { ...block, wrap: null, kind: "p" };
      return { blocks: out, sel: caret(at.b, 0) };
    }
  }
  const head = sliceInline(block.content, 0, at.o);
  const tail = sliceInline(block.content, at.o, len);
  const cont = continuation(block);
  out[at.b] = { ...block, content: normalize(head) };
  // Enter at the very start of a heading pushes it down, leaving an empty line above
  if (at.o === 0 && len > 0) {
    out.splice(at.b, 0, textBlock(block.kind === "li" ? "li" : "p", [], block.wrap, block.kind === "li" ? { list: cont.list } : {}));
    out[at.b + 1] = block;
    return { blocks: out, sel: caret(at.b + 1, 0) };
  }
  out.splice(at.b + 1, 0, textBlock(cont.kind, normalize(tail), block.wrap, cont.kind === "li" ? { list: cont.list } : {}));
  return { blocks: out, sel: caret(at.b + 1, 0) };
}

/**
 * Backspace at the start of a block: a list item, heading or callout line
 * turns back into a plain line first, and only then joins the one above.
 */
export function joinBackward(blocks: Block[], index: number): Edit {
  const block = blocks[index];
  const out = blocks.slice();
  if (!block) return { blocks, sel: caret(index, 0) };
  if (isText(block)) {
    if (block.kind === "li" && block.list) {
      out[index] = block.list.indent > 0 ? { ...block, list: { ...block.list, indent: block.list.indent - 1 } } : { ...block, kind: "p", list: undefined };
      return { blocks: out, sel: caret(index, 0) };
    }
    if (block.kind !== "p") {
      out[index] = { ...block, kind: "p", label: undefined };
      return { blocks: out, sel: caret(index, 0) };
    }
    if (block.wrap && blocks[index - 1]?.wrap !== block.wrap) {
      out[index] = { ...block, wrap: null };
      return { blocks: out, sel: caret(index, 0) };
    }
  }
  const prev = blocks[index - 1];
  if (!prev) return { blocks, sel: caret(index, 0) };
  if (isVoid(prev)) {
    out.splice(index - 1, 1);
    return { blocks: out, sel: caret(index - 1, 0) };
  }
  if (prev.kind === "table") {
    // into the table's last cell, rather than through it
    const r = prev.rows.length - 1;
    const c = prev.align.length - 1;
    if (isText(block) && inlineLength(block.content) === 0) out.splice(index, 1);
    return { blocks: out, sel: caret(index - 1, inlineLength(prev.rows[r]?.[c] ?? []), [r, c]) };
  }
  if (prev.kind === "code") {
    const add = isText(block) ? plainOf(block.content) : block.kind === "code" ? block.text : "";
    out[index - 1] = { ...prev, text: prev.text + (add && prev.text ? "\n" : "") + add };
    out.splice(index, 1);
    return { blocks: out, sel: caret(index - 1, prev.text.length + (add && prev.text ? 1 : 0)) };
  }
  if (!isText(block)) {
    if (block.kind === "code" && block.text === "") {
      out.splice(index, 1);
      return { blocks: ensureBlock(out), sel: caret(index - 1, isText(prev) ? inlineLength(prev.content) : 0) };
    }
    return { blocks, sel: caret(index - 1, isText(prev) ? inlineLength(prev.content) : 0) };
  }
  const at = inlineLength(prev.content);
  out[index - 1] = { ...prev, content: normalize([...prev.content, ...block.content]) };
  out.splice(index, 1);
  return { blocks: out, sel: caret(index - 1, at) };
}

/** Delete at the end of a block: the next one joins it. */
export function joinForward(blocks: Block[], index: number): Edit {
  const block = blocks[index];
  const next = blocks[index + 1];
  if (!block || !next) return { blocks, sel: caret(index, block ? sizeAt(blocks, { b: index, o: 0 }) : 0) };
  if (isVoid(next)) {
    const out = blocks.slice();
    out.splice(index + 1, 1);
    return { blocks: out, sel: caret(index, sizeAt(blocks, { b: index, o: 0 })) };
  }
  if (isText(block) && isText(next)) {
    const at = inlineLength(block.content);
    const out = blocks.slice();
    out[index] = { ...block, content: normalize([...block.content, ...next.content]) };
    out.splice(index + 1, 1);
    return { blocks: out, sel: caret(index, at) };
  }
  return { blocks, sel: caret(index, sizeAt(blocks, { b: index, o: 0 })) };
}

/**
 * Deletes a selection, within a block or across blocks. Across the cells of
 * one table it empties them; across blocks, a table or rule it reaches into
 * goes whole, and the text on either side joins.
 */
export function deleteRange(blocks: Block[], sel: Sel): Edit {
  const [from, to] = ordered(sel);
  if (from.b === to.b && from.cell && to.cell && !sameCell(from, to)) {
    const table = blocks[from.b] as TableBlock;
    const cols = table.align.length;
    const rows = table.rows.map((row) => row.slice());
    const first = from.cell[0] * cols + from.cell[1];
    const last = to.cell[0] * cols + to.cell[1];
    for (let k = first; k <= last; k++) {
      const r = Math.floor(k / cols);
      const c = k % cols;
      const cell = rows[r]![c] ?? [];
      const len = inlineLength(cell);
      rows[r]![c] = spliceInline(cell, k === first ? from.o : 0, k === last ? to.o : len, []);
    }
    const out = blocks.slice();
    out[from.b] = { ...table, rows };
    return { blocks: out, sel: caret(from.b, from.o, from.cell) };
  }
  if (from.b === to.b && sameCell(from, to)) {
    const block = blocks[from.b];
    if (!block) return { blocks, sel: caret(from.b, from.o) };
    const out = blocks.slice();
    if (block.kind === "code") {
      out[from.b] = { ...block, text: block.text.slice(0, from.o) + block.text.slice(to.o) };
    } else if (block.kind === "table" && from.cell) {
      const [r, c] = from.cell;
      const rows = block.rows.map((row) => row.slice());
      rows[r]![c] = spliceInline(rows[r]![c] ?? [], from.o, to.o, []);
      out[from.b] = { ...block, rows };
    } else if (isText(block)) {
      out[from.b] = { ...block, content: spliceInline(block.content, from.o, to.o, []) };
    }
    return { blocks: out, sel: from.cell ? caret(from.b, from.o, from.cell) : caret(from.b, from.o) };
  }
  // A table or rule at either end goes whole; text or code there keeps what
  // lies outside the selection, and the two sides join when they can.
  const first = blocks[from.b];
  const last = blocks[to.b];
  const head = first && (isText(first) || first.kind === "code") ? cut(first, 0, from.o) : null;
  const tail = last && (isText(last) || last.kind === "code") ? cut(last, to.o, Infinity) : null;
  const kept: Block[] = [];
  if (head && tail && isText(head) && isText(tail)) kept.push({ ...head, content: normalize([...head.content, ...tail.content]) });
  else if (head && tail && head.kind === "code" && tail.kind === "code") kept.push({ ...head, text: head.text + tail.text });
  else {
    if (head) kept.push(head);
    if (tail) kept.push(tail);
  }
  if (kept.length === 0) kept.push(textBlock("p", [], first?.wrap === "quote" ? "quote" : (first?.wrap ?? null)));
  const out = blocks.slice();
  out.splice(from.b, to.b - from.b + 1, ...kept);
  return { blocks: ensureBlock(out), sel: caret(from.b, head ? from.o : 0) };
}

/** A block's text from one offset to another (to the end with Infinity), as a block of the same kind. */
function cut(block: Block, from: number, to: number): Block {
  if (block.kind === "code") return { ...block, text: block.text.slice(from, to === Infinity ? undefined : to) };
  if (!isText(block)) return block;
  const len = inlineLength(block.content);
  return { ...block, content: sliceInline(block.content, from, Math.min(len, to)) };
}

/** The indexes of the blocks a selection touches. */
export function blocksIn(sel: Sel): number[] {
  const [from, to] = ordered(sel);
  const out: number[] = [];
  for (let b = from.b; b <= to.b; b++) out.push(b);
  return out;
}

/**
 * Applies `fn` to the marks of what the selection covers, in text blocks and
 * table cells alike; code blocks keep none.
 */
export function mapSelection(blocks: Block[], sel: Sel, fn: (m: Marks) => Marks): Block[] {
  const [from, to] = ordered(sel);
  const out = blocks.slice();
  for (let b = from.b; b <= to.b; b++) {
    const block = out[b];
    if (!block) continue;
    if (block.kind === "table") {
      if (from.cell && to.cell && from.b === to.b && sameCell(from, to)) {
        const [r, c] = from.cell;
        const rows = block.rows.map((row) => row.slice());
        rows[r]![c] = mapMarks(rows[r]![c] ?? [], from.o, to.o, fn);
        out[b] = { ...block, rows };
      } else {
        // a table the selection runs across is formatted whole
        out[b] = { ...block, rows: block.rows.map((row) => row.map((cell) => mapMarks(cell, 0, inlineLength(cell), fn))) };
      }
      continue;
    }
    if (!isText(block)) continue;
    const len = inlineLength(block.content);
    const s = b === from.b ? from.o : 0;
    const e = b === to.b ? to.o : len;
    out[b] = { ...block, content: mapMarks(block.content, s, e, fn) };
  }
  return out;
}

/** Whether everything the selection covers passes `test`; false for an empty selection. */
export function selectionHas(blocks: Block[], sel: Sel, test: (m: Marks) => boolean): boolean {
  const [from, to] = ordered(sel);
  let seen = false;
  for (let b = from.b; b <= to.b; b++) {
    const block = blocks[b];
    if (!block) continue;
    let parts: Inline[][] = [];
    if (block.kind === "table") {
      if (from.cell && sameCell(from, to)) parts = [sliceInline(block.rows[from.cell[0]]?.[from.cell[1]] ?? [], from.o, to.o)];
      else parts = block.rows.flat();
    } else if (isText(block)) {
      const len = inlineLength(block.content);
      parts = [sliceInline(block.content, b === from.b ? from.o : 0, b === to.b ? to.o : len)];
    }
    for (const part of parts) {
      for (const r of part) {
        if (r.kind === "text" && r.text.trim() === "") continue;
        seen = true;
        if (!test(r.marks)) return false;
      }
    }
  }
  return seen;
}

/** The runs of a selection that sits inside one block or cell, for copying and for a link's words. */
export function selectedRuns(blocks: Block[], sel: Sel): Inline[] {
  const [from, to] = ordered(sel);
  if (from.b !== to.b || !sameCell(from, to)) return [];
  const block = blocks[from.b];
  if (!block) return [];
  if (block.kind === "table" && from.cell) return sliceInline(block.rows[from.cell[0]]?.[from.cell[1]] ?? [], from.o, to.o);
  if (block.kind === "code") return [text(block.text.slice(from.o, to.o))];
  if (!isText(block)) return [];
  return sliceInline(block.content, from.o, to.o);
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

/** Makes the selected text blocks headings, subtext or plain lines. */
export function setKind(blocks: Block[], sel: Sel, kind: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "subtext"): Block[] {
  const out = blocks.slice();
  for (const b of blocksIn(sel)) {
    const block = out[b];
    if (!isText(block)) continue;
    // a heading cannot be in a plain quote (a quote holds lines of text), so it leaves the quote
    const wrap = block.wrap === "quote" && kind !== "p" ? null : block.wrap;
    out[b] = { ...block, kind, list: undefined, label: undefined, wrap };
  }
  return out;
}

/**
 * Makes the selected lines a list of this kind, or plain lines again when
 * they all are one already.
 */
export function toggleList(blocks: Block[], sel: Sel, type: "bullet" | "ordered" | "task"): Block[] {
  const indexes = blocksIn(sel).filter((b) => isText(blocks[b]));
  const is = (block: Block | undefined) => isText(block) && block.kind === "li" && !!block.list && (type === "task" ? block.list.task : !block.list.task && block.list.ordered === (type === "ordered"));
  const all = indexes.length > 0 && indexes.every((b) => is(blocks[b]));
  const out = blocks.slice();
  for (const b of indexes) {
    const block = out[b] as TextBlock;
    if (all) {
      out[b] = { ...block, kind: "p", list: undefined };
      continue;
    }
    const was = block.list;
    // lists cannot be in a plain quote either
    const wrap = block.wrap === "quote" ? null : block.wrap;
    out[b] = {
      ...block,
      kind: "li",
      wrap,
      label: undefined,
      list: {
        ordered: type === "ordered",
        task: type === "task",
        checked: type === "task" ? (was?.checked ?? false) : false,
        indent: was?.indent ?? 0,
        start: type === "ordered" && was?.ordered ? was.start : null,
      },
    };
  }
  return out;
}

/** Tab and Shift+Tab in a list: one level in or out. */
export function indentBy(blocks: Block[], sel: Sel, delta: 1 | -1): Block[] {
  const out = blocks.slice();
  for (const b of blocksIn(sel)) {
    const block = out[b];
    if (!isText(block) || block.kind !== "li" || !block.list) continue;
    const prevIndent = (() => {
      for (let k = b - 1; k >= 0; k--) {
        const p = out[k];
        if (isText(p) && p.kind === "li" && p.list && p.wrap === block.wrap) return p.list.indent;
        break;
      }
      return -1;
    })();
    // one level deeper than the item above at most, as markdown can say no more
    const indent = Math.max(0, Math.min(MAX_INDENT, block.list.indent + delta, prevIndent + 1));
    out[b] = { ...block, list: { ...block.list, indent } };
  }
  return out;
}

export function toggleChecked(blocks: Block[], index: number): Block[] {
  const block = blocks[index];
  if (!isText(block) || !block.list?.task) return blocks;
  const out = blocks.slice();
  out[index] = { ...block, list: { ...block.list, checked: !block.list.checked } };
  return out;
}

/**
 * Puts the selected blocks in a quote, callout or folded section, or takes
 * them out when they all are in one of that kind. A plain quote holds lines
 * of text, so headings and list items in it become plain lines; code, rules
 * and tables stay outside it.
 */
export function toggleWrap(blocks: Block[], sel: Sel, wrap: Exclude<Wrap, null>): Edit {
  const indexes = blocksIn(sel);
  const all = indexes.every((b) => blocks[b]?.wrap === wrap);
  const out = blocks.slice();
  for (const b of indexes) {
    const block = out[b];
    if (!block) continue;
    if (all) {
      out[b] = { ...block, wrap: null };
      continue;
    }
    if (wrap === "quote") {
      if (!isText(block)) continue;
      out[b] = { ...block, kind: "p", list: undefined, label: undefined, wrap };
    } else out[b] = { ...block, wrap };
  }
  const [from, to] = ordered(sel);
  if (!all && wrap === "details" && out[from.b - 1]?.wrap !== "details") {
    // A new folded section: its first line is the summary. One line on its
    // own gets an empty line under it for what the section hides, and the
    // caret goes there once the summary has words.
    const first = out[from.b];
    if (from.b === to.b && isText(first)) {
      if (first.kind !== "p") out[from.b] = { ...first, kind: "p", list: undefined, label: undefined };
      out.splice(from.b + 1, 0, textBlock("p", [], "details"));
      return { blocks: out, sel: inlineLength(first.content) ? caret(from.b + 1, 0) : caret(from.b, 0) };
    }
    if (!isText(first)) {
      out.splice(from.b, 0, textBlock("p", [], "details"));
      return { blocks: out, sel: caret(from.b, 0) };
    }
  }
  return { blocks: out, sel: { anchor: from, focus: to } };
}

/**
 * Turns the selected lines into one code block, or a code block back into
 * lines; with a caret on an empty line, that line becomes the code block.
 */
export function toggleCode(blocks: Block[], sel: Sel): Edit {
  const indexes = blocksIn(sel);
  const first = blocks[indexes[0] ?? 0];
  if (first?.kind === "code" && indexes.length === 1) {
    const lines = first.text.split("\n").map((line) => textBlock("p", line ? [text(line)] : [], first.wrap === "quote" ? null : first.wrap));
    const out = blocks.slice();
    out.splice(indexes[0]!, 1, ...lines);
    return { blocks: out, sel: caret(indexes[0]!, 0) };
  }
  const texts = indexes.map((b) => blocks[b]).filter(isText);
  if (texts.length === 0) return { blocks, sel };
  const joined = texts.map((b) => plainOf(b.content)).join("\n");
  const code: CodeBlock = { id: newId(), kind: "code", lang: "", text: joined, wrap: texts[0]!.wrap === "quote" ? null : texts[0]!.wrap };
  const out = blocks.slice();
  const start = indexes.find((b) => isText(blocks[b]))!;
  const end = indexes.filter((b) => isText(blocks[b])).pop()!;
  out.splice(start, end - start + 1, code);
  return { blocks: out, sel: caret(start, joined.length) };
}

/** Inserts a block after the caret's block, or in place of an empty line; the caret goes to the line after it. */
export function insertBlock(blocks: Block[], sel: Sel, block: Block): Edit {
  const [from] = ordered(sel);
  const here = blocks[from.b];
  const out = blocks.slice();
  const wrap = here && here.wrap !== "quote" ? here.wrap : null;
  const placed = { ...block, wrap } as Block;
  let at: number;
  if (isText(here) && here.kind === "p" && inlineLength(here.content) === 0) {
    out.splice(from.b, 1, placed);
    at = from.b;
  } else {
    out.splice(from.b + 1, 0, placed);
    at = from.b + 1;
  }
  // there is always a line to carry on typing after it
  if (!isText(out[at + 1])) out.splice(at + 1, 0, textBlock("p", [], wrap));
  if (placed.kind === "table") return { blocks: out, sel: caret(at, 0, [0, 0]) };
  if (placed.kind === "code") return { blocks: out, sel: caret(at, 0) };
  return { blocks: out, sel: caret(at + 1, 0) };
}

export function emptyTable(rows: number, cols: number): TableBlock {
  return { id: newId(), kind: "table", wrap: null, align: Array.from({ length: cols }, () => null), rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => [] as Inline[])) };
}

/** Table edits: rows and columns in or out, a column's alignment. */
export function editTable(blocks: Block[], index: number, op: { kind: "addRow"; at: number } | { kind: "addCol"; at: number } | { kind: "delRow"; at: number } | { kind: "delCol"; at: number } | { kind: "align"; col: number; align: Align }): Block[] {
  const table = blocks[index];
  if (!table || table.kind !== "table") return blocks;
  const out = blocks.slice();
  const cols = table.align.length;
  let rows = table.rows.map((row) => row.slice());
  let align = table.align.slice();
  switch (op.kind) {
    case "addRow":
      rows.splice(Math.max(1, op.at), 0, Array.from({ length: cols }, () => [] as Inline[]));
      break;
    case "addCol":
      rows = rows.map((row) => {
        const r = row.slice();
        r.splice(op.at, 0, []);
        return r;
      });
      align.splice(op.at, 0, null);
      break;
    case "delRow":
      // the header row stays: a table without one is not a table
      if (op.at > 0) rows.splice(op.at, 1);
      break;
    case "delCol":
      if (cols <= 1) {
        out.splice(index, 1);
        return ensureBlock(out);
      }
      rows = rows.map((row) => row.filter((_, c) => c !== op.at));
      align = align.filter((_, c) => c !== op.at);
      break;
    case "align":
      align[op.col] = op.align;
      break;
  }
  out[index] = { ...table, rows, align };
  return out;
}

/** Takes every mark off the selection, and makes headings and subtext plain lines again. */
export function clearFormatting(blocks: Block[], sel: Sel): Block[] {
  const out = mapSelection(blocks, sel, () => ({}));
  for (const b of blocksIn(sel)) {
    const block = out[b];
    if (isText(block) && block.kind !== "p" && block.kind !== "li" && block.kind !== "note") out[b] = { ...block, kind: "p" };
  }
  return out;
}
