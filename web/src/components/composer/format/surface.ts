import type { AlertKind, Align } from "@/markdown/ast";
import { FALLBACK_SURFACE, paintColor, surfaceOf, type Surface } from "@/markdown/colors";
import { fileWidth } from "@/markdown/parse";
import { alignment } from "@/lib/align";
import { fromMarkdown, inlineFromMarkdown, inlineMarkdown, toMarkdown, type AtomNames, type ReadOptions } from "./markdown";
import {
  caret,
  clampPos,
  clearFormatting,
  collapsed,
  comparePos,
  deleteRange,
  editTable,
  emptyTable,
  FLAGS,
  indentBy,
  inlineLength,
  insertAt,
  insertBlock,
  isText,
  isVoid,
  joinBackward,
  joinForward,
  linkAround,
  mapMarks,
  mapSelection,
  marksAt,
  newId,
  normalize,
  ordered,
  sameCell,
  sameMarks,
  selectionHas,
  selectedRuns,
  setKind,
  sizeAt,
  splitAt,
  spliceInline,
  textBlock,
  toggleChecked,
  toggleCode,
  toggleList,
  toggleWrap,
  withColor,
  withLink,
  withMark,
  type Block,
  type FileBlock,
  type Flag,
  type Inline,
  type ListInfo,
  type Marks,
  type Pos,
  type Sel,
  type TableBlock,
  type TextBlock,
  type TextKind,
  type Wrap,
} from "./model";

// ---------------------------------------------------------------------------
// The formatting editor's writing surface.
//
// The document lives in the model (model.ts); the page shows it in a
// contenteditable element drawn from it. Ordinary typing is left to the
// browser, because only the browser's own editing works with every input
// method, autocorrect, dictation and touch selection handle there is; after
// each change the surface reads its own DOM back into the model. Anything
// structural (Enter, joining lines, deleting across blocks, formatting,
// paste, undo) is done on the model instead, and the surface is drawn again.
// Nothing is ever drawn again while an input method is composing a word.
// ---------------------------------------------------------------------------

export interface SurfaceState {
  /** The marks the toolbar shows as on: every character selected has them, or typing at the caret would. */
  marks: Marks;
  kind: TextKind | "code" | "hr" | "table" | "file" | null;
  list: ListInfo | null;
  wrap: Wrap;
  table: { row: number; col: number; rows: number; cols: number; align: Align } | null;
  code: { lang: string } | null;
  link: { url: string; noEmbed: boolean } | null;
  collapsed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The selected words, when they sit in one block: what a new link would be called. */
  selectedText: string;
}

export interface SurfaceLabels {
  placeholder: string;
  summary: string;
  code: string;
  alert: (kind: AlertKind) => string;
}

export interface SurfaceOptions {
  labels: SurfaceLabels;
  names?: AtomNames;
  /** The document changed. */
  onChange: () => void;
  /** The selection or the document changed: the toolbar follows. */
  onState: (state: SurfaceState) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  /** Ctrl/Cmd+K: the link tray should open. */
  onLinkKey?: () => void;
  /** Escape. */
  onEscape?: () => void;
  /**
   * A note's editor: file lines are files, shown as blocks (the chat's
   * formatting editor has neither), and the text may be as long as `max`.
   */
  read?: ReadOptions;
  /**
   * The file blocks on show, each with the element to draw its file in. Told
   * after every draw that changed them; the surface draws nothing there itself.
   */
  onFiles?: (shown: FileHost[]) => void;
  /** Files pasted in: the editor uploads them and puts them where the caret is. */
  onPasteFiles?: (files: File[]) => void;
  /** The surface was drawn again: what is drawn over it (someone else's caret) is placed again. */
  onDraw?: () => void;
}

/**
 * A place in a note that still means the same place in someone else's copy
 * of it, which may be a moment ahead or behind: which block (by where it is,
 * and by a short hash of what it says, to find it again after blocks above
 * it came or went) and how far into it.
 */
export interface PlaceMark {
  b: number;
  o: number;
  cell?: [number, number];
  k: string;
}

/** Where someone's selection runs from and to; the same place twice is a caret. */
export interface CursorMark {
  a: PlaceMark;
  f: PlaceMark;
}

/** Someone else's selection as drawn: the caret's line, and the boxes the selection covers. */
export interface CursorRects {
  caret: { left: number; top: number; height: number } | null;
  boxes: { left: number; top: number; width: number; height: number }[];
}

/** A file block on the surface: which block, which file, and where to draw it. */
export interface FileHost {
  key: number;
  file: string;
  name: string;
  /** How much of the line a picture takes, in percent (100 when the text says nothing). */
  width: number;
  el: HTMLElement;
}

export type TableOp = { kind: "addRow"; at: number } | { kind: "addCol"; at: number } | { kind: "delRow"; at: number } | { kind: "delCol"; at: number } | { kind: "align"; col: number; align: Align } | { kind: "delete" };

export type Command =
  | { t: "mark"; flag: Flag }
  | { t: "color"; part: "fg" | "bg"; value: string | null }
  | { t: "link"; url: string | null; noEmbed?: boolean; text?: string }
  | { t: "kind"; kind: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "subtext" }
  | { t: "list"; type: "bullet" | "ordered" | "task" }
  | { t: "indent"; delta: 1 | -1 }
  | { t: "check" }
  | { t: "wrap"; wrap: Exclude<Wrap, null> }
  | { t: "code" }
  | { t: "lang"; lang: string }
  | { t: "table"; rows: number; cols: number }
  | { t: "tableOp"; op: TableOp }
  | { t: "hr" }
  | { t: "file"; file: string; name: string }
  /** Takes out one block, by its key: a file, from the button drawn on it. */
  | { t: "removeBlock"; key: number }
  /** How wide a picture is drawn, in percent of the line: from the handles drawn on it. */
  | { t: "fileWidth"; key: number; width: number }
  | { t: "clear" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "text"; text: string };

interface Snapshot {
  blocks: Block[];
  sel: Sel;
}

/** What a block says, as markdown: two blocks that read the same have the same one. */
function signature(block: Block): string {
  return block.kind + "\u0000" + toMarkdown([block]);
}

/** A short hash of what a block says (FNV-1a), to find it again in another copy of the note. */
function blockKey(block: Block | undefined): string {
  if (!block) return "";
  const text = signature(block);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A block's characters as the caret counts them: an atom is one. */
function counted(block: Block | undefined): string | null {
  if (!block) return null;
  if (block.kind === "code") return block.text;
  if (!isText(block)) return null;
  return block.content.map((r) => (r.kind === "text" ? r.text : "\uFFFC")).join("");
}

/**
 * Where a place in the old document is in the new one, when someone else's
 * change replaced it: `map` says which old blocks are still there and where.
 * A place in a block that stayed is the same place. In a block that changed,
 * it stays with the words around it: before the change it does not move,
 * after it it moves by as much as the block grew or shrank.
 */
function follow(before: Block[], next: Block[], map: Int32Array, p: Pos): Pos {
  const to = map[p.b];
  if (to === undefined) return p;
  if (to >= 0) return { ...p, b: to };
  // between the nearest blocks that stayed, as far in as it was
  let above = p.b - 1;
  while (above >= 0 && map[above]! < 0) above -= 1;
  let below = p.b + 1;
  while (below < before.length && map[below]! < 0) below += 1;
  const lo = above >= 0 ? map[above]! + 1 : 0;
  const hi = below < before.length ? map[below]! - 1 : next.length - 1;
  if (hi < lo) {
    // the block is gone with nothing in its place: the end of the one before
    const b = Math.max(0, lo - 1);
    return { b, o: lo > 0 ? sizeAt(next, { b, o: 0 }) : 0 };
  }
  const b = Math.min(hi, lo + (p.b - (above + 1)));
  const was = counted(before[p.b]);
  const now = counted(next[b]);
  if (was === null || now === null || p.cell) return { b, o: 0, ...(next[b]?.kind === "table" ? { cell: p.cell ?? [0, 0] } : {}) };
  let pre = 0;
  while (pre < was.length && pre < now.length && was[pre] === now[pre]) pre += 1;
  let suf = 0;
  while (suf < was.length - pre && suf < now.length - pre && was[was.length - 1 - suf] === now[now.length - 1 - suf]) suf += 1;
  if (p.o <= pre) return { b, o: p.o };
  if (p.o >= was.length - suf) return { b, o: now.length - (was.length - p.o) };
  return { b, o: now.length - suf };
}

/** Where each line of a text starts. */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

/**
 * Where a block's words start on its line of markdown, past what makes the
 * line a heading, an item, a quote: the line ends with the words, written as
 * they are, unless a backslash had to be put before something at their start.
 */
function contentStart(line: string, block: Block): number {
  if (!isText(block)) return -1;
  const words = inlineMarkdown(block.content);
  if (line.endsWith(words)) return line.length - words.length;
  if (words && line.endsWith(words.slice(1))) return Math.max(0, line.length - words.length - 1);
  return -1;
}

/** Whether an event's target is inside one of the frames a file is drawn in. */
function inFileHost(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Node)) return false;
  const el = target instanceof Element ? target : target.parentElement;
  const host = el?.closest("[data-file-host]");
  return !!host && root.contains(host);
}

const ZWSP = /​/g;
const MAX_HISTORY = 200;
/** Typing this close together is one step of undo. */
const COALESCE_MS = 900;

/** What sits between a text block's markers and its words, as the toolbar and the CSS know them. */
const TAG_OF_FLAG: Record<Exclude<Flag, "spoiler">, string> = { b: "strong", i: "em", u: "u", s: "s", code: "code", mark: "mark", sup: "sup", sub: "sub" };

export class FormatSurface {
  blocks: Block[] = [textBlock()];
  sel: Sel = caret(0, 0);
  private readonly root: HTMLElement;
  private readonly opts: SurfaceOptions;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private lastTyping = 0;
  private composing = false;
  /** The text of the block a composition started in, to find what it inserted. */
  private composeFrom: { b: number; cell?: [number, number]; text: string } | null = null;
  /** Marks chosen with nothing selected: the next typing takes them. */
  private pending: { at: Pos; marks: Marks } | null = null;
  private elements = new Map<Block, HTMLElement>();
  private surface: Surface = FALLBACK_SURFACE;
  private stateFrame = 0;
  private filesShown: FileHost[] = [];
  private destroyed = false;
  private readonly listeners: [EventTarget, string, EventListener][] = [];

  constructor(root: HTMLElement, opts: SurfaceOptions) {
    this.root = root;
    this.opts = opts;
    root.contentEditable = "true";
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");
    root.spellcheck = true;
    // What the editor draws inside a file block (its buttons, its player) is
    // its own: a key pressed there is not typing in the note.
    const mine = (e: Event): boolean => !inFileHost(e.target, root);
    this.on(root, "beforeinput", (e) => mine(e) && this.onBeforeInput(e as InputEvent));
    this.on(root, "input", () => this.onInput());
    this.on(root, "compositionstart", () => this.onCompositionStart());
    this.on(root, "compositionend", () => this.onCompositionEnd());
    this.on(root, "keydown", (e) => mine(e) && this.onKeyDown(e as KeyboardEvent));
    this.on(root, "paste", (e) => mine(e) && this.onPaste(e as ClipboardEvent));
    this.on(root, "copy", (e) => mine(e) && this.onCopy(e as ClipboardEvent, false));
    this.on(root, "cut", (e) => mine(e) && this.onCopy(e as ClipboardEvent, true));
    this.on(root, "click", (e) => mine(e) && this.onClick(e as MouseEvent));
    this.on(root, "dragstart", (e) => e.preventDefault());
    this.on(root, "drop", (e) => e.preventDefault());
    this.on(document, "selectionchange", () => this.onSelectionChange());
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  destroy(): void {
    this.destroyed = true;
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn);
    if (this.stateFrame) cancelAnimationFrame(this.stateFrame);
  }

  // -------------------------------------------------------------------------
  // loading and writing out
  // -------------------------------------------------------------------------

  /** Shows a message's markdown; says whether anything nested had to be shown simpler. */
  load(markdown: string): boolean {
    const loaded = fromMarkdown(markdown, this.opts.names, this.opts.read);
    this.blocks = loaded.blocks;
    const last = this.blocks.length - 1;
    this.sel = caret(last, sizeAt(this.blocks, { b: last, o: 0 }));
    this.past = [];
    this.future = [];
    this.render();
    return loaded.simplified;
  }

  /**
   * Where the caret is, as an offset into the markdown this surface writes
   * (markdown()), when it can be said exactly: a caret, not a selection, in
   * the text of a block, with no emoji or mention before it on its line.
   * Null otherwise, and while the keyboard is elsewhere.
   */
  caretMarkdown(): number | null {
    if (this.composing || !this.active) return null;
    this.syncSelection();
    const { anchor, focus } = this.sel;
    if (comparePos(anchor, focus) !== 0 || focus.cell) return null;
    const block = this.blocks[focus.b];
    const visible = counted(block);
    if (!block || visible === null) return null;
    const lines = new Map<Block, number>();
    const md = toMarkdown(this.blocks, lines);
    const line = lines.get(block);
    if (line === undefined) return null;
    const starts = lineStarts(md);
    if (block.kind === "code") {
      // the code starts on the line after its fence, written as it is
      const at = starts[line + 1];
      return at === undefined ? null : at + Math.min(focus.o, block.text.length);
    }
    const prefix = visible.slice(0, focus.o);
    if (prefix.includes("\uFFFC")) return null;
    const from = starts[line]!;
    const text = md.slice(from, (starts[line + 1] ?? md.length + 1) - 1);
    let i = contentStart(text, block);
    if (i < 0) return null;
    for (let j = 0; j < prefix.length; j++) {
      while (i < text.length && text.charCodeAt(i) !== prefix.charCodeAt(j)) i += 1;
      if (i >= text.length) return null;
      i += 1;
    }
    return from + i;
  }

  /** The place an offset into `markdown` names, when that markdown is what these blocks write. */
  private placeOf(markdown: string, at: number): Pos | null {
    const lines = new Map<Block, number>();
    if (toMarkdown(this.blocks, lines) !== markdown) return null;
    const starts = lineStarts(markdown);
    // the line the offset is on
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    for (let b = 0; b < this.blocks.length; b++) {
      const block = this.blocks[b]!;
      const line = lines.get(block);
      if (line === undefined) continue;
      if (block.kind === "code") {
        const first = starts[line + 1];
        const count = block.text.split("\n").length;
        if (first !== undefined && lo >= line + 1 && lo < line + 1 + count) return { b, o: Math.max(0, Math.min(block.text.length, at - first)) };
        continue;
      }
      if (line !== lo || !isText(block)) continue;
      const visible = counted(block) ?? "";
      const from = starts[line]!;
      const text = markdown.slice(from, (starts[line + 1] ?? markdown.length + 1) - 1);
      const start = contentStart(text, block);
      if (start < 0) return null;
      let j = 0;
      for (let i = start; i < at - from && j < visible.length; i++) {
        if (text.charCodeAt(i) === visible.charCodeAt(j)) j += 1;
      }
      return { b, o: j };
    }
    return null;
  }

  /**
   * Shows other markdown in place of what is here, with the caret kept where
   * it was as nearly as the new text allows: for a note that someone else
   * changed while it is open. `caretAt`, when the caller knows it, is exactly
   * where the caret is to go, as an offset into the new markdown. Nothing is
   * done while a word is being composed; the caller tries again after.
   */
  reload(markdown: string, caretAt?: number | null): boolean {
    if (this.composing) return false;
    // the caret is here if the keyboard is, or if the page's selection is: it
    // is put back after the swap, which would otherwise leave it on text that is gone
    const picked = document.getSelection();
    const had = document.activeElement === this.root || this.root.contains(document.activeElement) || (!!picked?.anchorNode && this.root.contains(picked.anchorNode) && this.syncSelection());
    if (had) this.syncSelection();
    const loaded = fromMarkdown(markdown, this.opts.names, this.opts.read);
    const before = this.blocks;
    const next = loaded.blocks.slice();
    // A block that reads the same as before is the same block: it keeps its
    // object, and with it its element on the page, so only what someone
    // changed is drawn again and the rest does not so much as flicker.
    const map = alignment(before.map(signature), next.map(signature));
    map.forEach((j, i) => {
      if (j >= 0) next[j] = before[i]!;
    });
    const moved = (p: Pos): Pos => clampPos(next, follow(before, next, map, p));
    // a format chosen to type with (Bold pressed with nothing selected) stays chosen at the caret:
    // someone else writing elsewhere is no reason to drop what this person is about to type
    const keep = this.pending && collapsed(this.sel) && comparePos(this.pending.at, this.sel.focus) === 0 ? this.pending.marks : null;
    const sel = { anchor: moved(this.sel.anchor), focus: moved(this.sel.focus) };
    // nothing of the page's own changed place: the selection is still right where the browser has it
    const still = map[this.sel.anchor.b]! >= 0 && map[this.sel.focus.b]! >= 0;
    this.blocks = next;
    this.sel = sel;
    this.pending = null;
    this.past = [];
    this.future = [];
    this.render();
    // Where the caller says the caret goes, it goes. Without that, someone
    // else's words put in right where the caret was could land on either
    // side of it, and the next letter typed would end up among theirs.
    const exact = had && caretAt !== undefined && caretAt !== null ? this.placeOf(markdown, caretAt) : null;
    if (exact) {
      this.sel = caret(exact.b, exact.o);
      this.placeSelection();
    } else if (had && !still) this.placeSelection();
    if (keep && collapsed(this.sel)) this.pending = { at: this.sel.focus, marks: keep };
    this.emitState();
    return true;
  }

  /** Whether a word is being composed (an input method, dictation): the document should not be swapped under it. */
  get busy(): boolean {
    return this.composing;
  }

  markdown(): string {
    return toMarkdown(this.blocks);
  }

  focus(): void {
    this.placeSelection();
  }

  // -------------------------------------------------------------------------
  // where people's carets are, for a note written together
  // -------------------------------------------------------------------------

  /** Whether the keyboard is in the surface (or the page's selection is). */
  get active(): boolean {
    const picked = document.getSelection();
    return this.root.contains(document.activeElement) || (!!picked?.anchorNode && this.root.contains(picked.anchorNode));
  }

  /** Where this page's caret and selection are, as places another copy of the note can find. */
  cursor(): CursorMark {
    if (this.active && !this.composing) this.syncSelection();
    return { a: this.mark(this.sel.anchor), f: this.mark(this.sel.focus) };
  }

  private mark(p: Pos): PlaceMark {
    return { b: p.b, o: p.o, ...(p.cell ? { cell: p.cell } : {}), k: blockKey(this.blocks[p.b]) };
  }

  /**
   * A place from another copy of the note, in this one: the block that says
   * what it said, nearest where it was, or, when none does (it is the one
   * being written in), the block in its place.
   */
  locate(m: PlaceMark): Pos | null {
    if (!m || !Number.isInteger(m.b) || !Number.isInteger(m.o) || m.b < 0 || m.o < 0) return null;
    let b = -1;
    if (blockKey(this.blocks[m.b]) === m.k) b = m.b;
    else {
      for (let d = 1; d < 64 && b < 0; d++) {
        if (blockKey(this.blocks[m.b - d]) === m.k) b = m.b - d;
        else if (blockKey(this.blocks[m.b + d]) === m.k) b = m.b + d;
      }
    }
    if (b < 0) b = Math.min(m.b, this.blocks.length - 1);
    const cell = Array.isArray(m.cell) && m.cell.length === 2 && m.cell.every((n) => Number.isInteger(n) && n >= 0) ? m.cell : undefined;
    return clampPos(this.blocks, { b, o: m.o, ...(cell ? { cell } : {}) });
  }

  /**
   * Where to draw someone else's caret and selection, in the coordinates of
   * the page (getBoundingClientRect's): the caret as a line as tall as the
   * line it is on, and their selection as the boxes of the lines it covers.
   */
  cursorRects(c: CursorMark): CursorRects {
    const a = this.locate(c.a);
    const f = this.locate(c.f);
    if (!a || !f) return { caret: null, boxes: [] };
    const caret = this.caretBox(f);
    if (comparePos(a, f) === 0) return { caret, boxes: [] };
    const [from, to] = comparePos(a, f) < 0 ? [a, f] : [f, a];
    const start = this.toDom(from);
    const end = this.toDom(to);
    const boxes: CursorRects["boxes"] = [];
    if (start && end) {
      const range = document.createRange();
      try {
        range.setStart(start[0], start[1]);
        range.setEnd(end[0], end[1]);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width > 0.5 && r.height > 0) boxes.push({ left: r.left, top: r.top, width: r.width, height: r.height });
        }
      } catch {
        /* a place the browser will not take: no boxes */
      }
    }
    return { caret, boxes };
  }

  /** The line a caret at p stands on. */
  private caretBox(p: Pos): CursorRects["caret"] {
    const block = this.blocks[p.b];
    const el = block ? this.elements.get(block) : undefined;
    if (!block || !el) return null;
    const lineOf = (box: DOMRect, left: number) => {
      const cs = getComputedStyle(el);
      const line = Number.parseFloat(cs.lineHeight);
      const height = Number.isFinite(line) && line > 0 ? Math.min(line, box.height || line) : box.height;
      return { left, top: box.top, height };
    };
    // before a picture or a divider: along its starting edge
    if (isVoid(block)) {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, height: box.height };
    }
    const at = this.toDom(p);
    if (!at) return null;
    const range = document.createRange();
    try {
      range.setStart(at[0], at[1]);
      range.collapse(true);
    } catch {
      return null;
    }
    const rects = range.getClientRects();
    const r = rects[rects.length - 1] ?? range.getBoundingClientRect();
    if (r && (r.height > 0 || r.top !== 0)) return { left: r.left, top: r.top, height: r.height };
    // an empty line has no text to measure: the start of the line itself
    const host = (at[0] instanceof HTMLElement ? at[0] : at[0].parentElement) ?? el;
    const box = host.getBoundingClientRect();
    const rtl = getComputedStyle(host).direction === "rtl";
    const pad = Number.parseFloat(getComputedStyle(host).paddingInlineStart || "0") || 0;
    return lineOf(box, rtl ? box.right - pad : box.left + pad);
  }

  // -------------------------------------------------------------------------
  // drawing
  // -------------------------------------------------------------------------

  /** Draws the document, reusing the element of every block that did not change. */
  private render(): void {
    this.surface = this.root.isConnected ? surfaceOf(this.root) : FALLBACK_SURFACE;
    const next = new Map<Block, HTMLElement>();
    const children: HTMLElement[] = [];
    const counters: number[] = [];
    // A file whose block changed (made wider, or the note reloaded around it)
    // keeps its element, and with it the picture or player already drawn in it.
    const fileEls = new Map<string, HTMLElement>();
    for (const [block, el] of this.elements) {
      if (block.kind === "file" && !this.blocks.includes(block)) fileEls.set(block.file, el);
    }
    this.blocks.forEach((block, k) => {
      let el = this.elements.get(block);
      if (!el && block.kind === "file") {
        el = fileEls.get(block.file);
        fileEls.delete(block.file);
        if (el) el.dataset["id"] = String(block.id);
      }
      if (!el) el = this.draw(block);
      next.set(block, el);
      this.decorate(el, block, k, counters);
      children.push(el);
    });
    this.elements = next;
    // What is no longer drawn goes first, then only what is out of place is
    // moved. An element left where it is keeps the caret and the selection
    // inside it, which moving it would drop: with a line's old element still
    // in place, its new one going in front would push every line after it.
    const drawn = new Set<Node>(children);
    for (const node of [...this.root.childNodes]) if (!drawn.has(node)) node.remove();
    let at: ChildNode | null = this.root.firstChild;
    for (const el of children) {
      if (el === at) at = at.nextSibling;
      else this.root.insertBefore(el, at);
    }
    this.tellFiles();
    this.opts.onDraw?.();
  }

  /** The attributes that depend on a block's neighbours: list numbers, the first line of a callout, placeholders. */
  private decorate(el: HTMLElement, block: Block, k: number, counters: number[]): void {
    const prev = this.blocks[k - 1];
    const next = this.blocks[k + 1];
    const first = !prev || prev.wrap !== block.wrap;
    const last = !next || next.wrap !== block.wrap;
    set(el, "data-wrap", block.wrap);
    set(el, "data-first", block.wrap && first ? "" : null);
    set(el, "data-last", block.wrap && last ? "" : null);
    const { labels } = this.opts;
    if (block.wrap && block.wrap !== "quote" && block.wrap !== "details" && first) set(el, "data-title", labels.alert(block.wrap));
    else set(el, "data-title", null);
    // a folded section's first line is its summary
    set(el, "data-summary", block.wrap === "details" && first ? "" : null);
    const empty = isText(block) && block.content.length === 0;
    set(el, "data-empty", empty ? "" : null);
    let placeholder: string | null = null;
    if (empty && block.wrap === "details" && first) placeholder = labels.summary;
    else if (empty && this.blocks.length === 1) placeholder = labels.placeholder;
    set(el, "data-placeholder", placeholder);
    if (isText(block) && block.kind === "li" && block.list) {
      const list = block.list;
      counters.length = list.indent + 1;
      const n = list.ordered ? (list.start ?? (counters[list.indent] ?? 0) + 1) : 0;
      counters[list.indent] = n;
      set(el, "data-num", list.ordered ? `${n}.` : null);
      set(el, "data-indent", String(list.indent));
      set(el, "data-task", list.task ? (list.checked ? "done" : "open") : null);
    } else counters.length = 0;
    if (block.kind === "code") set(el, "data-lang", block.lang || labels.code);
    if (block.kind === "file") {
      if (block.width) el.style.setProperty("--file-w", `${block.width}%`);
      else el.style.removeProperty("--file-w");
      set(el, "data-width", block.width ? String(block.width) : null);
    }
  }

  /** Tells the editor which file blocks are on show, when that changed. */
  private tellFiles(): void {
    if (!this.opts.onFiles) return;
    const shown: FileHost[] = [];
    for (const block of this.blocks) {
      if (block.kind !== "file") continue;
      const el = this.elements.get(block)?.firstElementChild;
      if (el instanceof HTMLElement) shown.push({ key: block.id, file: block.file, name: block.name, width: block.width ?? 100, el });
    }
    const was = this.filesShown;
    if (was.length === shown.length && was.every((h, k) => h.key === shown[k]!.key && h.el === shown[k]!.el && h.width === shown[k]!.width)) return;
    this.filesShown = shown;
    this.opts.onFiles(shown);
  }

  private draw(block: Block): HTMLElement {
    const el = document.createElement(block.kind === "code" ? "pre" : "div");
    el.dataset["b"] = block.kind;
    el.dataset["id"] = String(block.id);
    switch (block.kind) {
      case "code":
        el.textContent = block.text;
        // a last empty line (or an empty block) needs something to stand on
        if (block.text === "" || block.text.endsWith("\n")) el.appendChild(document.createElement("br"));
        break;
      case "hr":
        el.contentEditable = "false";
        el.appendChild(document.createElement("hr"));
        break;
      case "file": {
        // an empty frame: the editor draws the file in it (onFiles)
        el.contentEditable = "false";
        const host = document.createElement("div");
        host.dataset["fileHost"] = block.file;
        host.setAttribute("aria-label", block.name);
        el.appendChild(host);
        break;
      }
      case "table":
        el.contentEditable = "false";
        el.appendChild(this.drawTable(block));
        break;
      default:
        if (block.kind === "li" && block.list) {
          el.dataset["list"] = block.list.task ? "task" : block.list.ordered ? "ordered" : "bullet";
        }
        if (block.kind === "note") el.dataset["label"] = block.label ?? "";
        this.drawInline(el, block.content);
    }
    return el;
  }

  private drawTable(block: TableBlock): HTMLTableElement {
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    block.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.forEach((cell, c) => {
        const td = document.createElement(r === 0 ? "th" : "td");
        td.contentEditable = "true";
        td.dataset["cell"] = `${r},${c}`;
        const align = block.align[c];
        if (align) td.style.textAlign = align === "left" ? "start" : align === "right" ? "end" : "center";
        this.drawInline(td, cell);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  private drawInline(parent: HTMLElement, content: Inline[]): void {
    for (const r of content) parent.appendChild(this.drawRun(r));
    if (content.length === 0) parent.appendChild(document.createElement("br"));
  }

  private drawRun(r: Inline): Node {
    let node: Node;
    if (r.kind === "atom") {
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.dataset["atom"] = r.raw;
      span.dataset["kind"] = r.atom;
      span.className = "atom";
      if (r.img) {
        const img = document.createElement("img");
        img.src = r.img;
        img.alt = r.label;
        img.draggable = false;
        span.appendChild(img);
      } else span.textContent = r.label;
      node = span;
    } else {
      node = document.createTextNode(r.text);
    }
    const m = r.marks;
    const wrap = (tag: string, extra?: (el: HTMLElement) => void) => {
      const el = document.createElement(tag);
      extra?.(el);
      el.appendChild(node);
      node = el;
    };
    if (m.code && r.kind === "text") wrap("code");
    for (const f of ["sub", "sup", "mark", "i", "b", "u", "s"] as const) if (m[f]) wrap(TAG_OF_FLAG[f]);
    if (m.spoiler) wrap("span", (el) => (el.dataset["m"] = "spoiler"));
    if (m.color) {
      const color = m.color;
      wrap("span", (el) => {
        el.dataset["m"] = "color";
        if (color.fg) el.dataset["fg"] = color.fg;
        if (color.bg) el.dataset["bg"] = color.bg;
        const paint = paintColor(color, this.surface);
        if (paint.color) el.style.color = paint.color;
        if (paint.background) el.style.backgroundColor = paint.background;
      });
    }
    if (m.link) {
      const link = m.link;
      wrap("span", (el) => {
        el.dataset["m"] = "link";
        el.dataset["url"] = link.url;
        if (link.noEmbed) el.dataset["quiet"] = "";
        el.title = link.url;
      });
    }
    return node;
  }

  // -------------------------------------------------------------------------
  // reading the page back
  // -------------------------------------------------------------------------

  /** Reads every block back from the page; true when anything changed. */
  private readBack(): boolean {
    const byId = new Map<string, Block>();
    for (const b of this.blocks) byId.set(String(b.id), b);
    const out: Block[] = [];
    let changed = false;
    for (const child of Array.from(this.root.childNodes)) {
      const read = this.readNode(child, byId);
      for (const b of read) out.push(b);
    }
    if (out.length === 0) out.push(textBlock());
    if (out.length !== this.blocks.length || out.some((b, k) => b !== this.blocks[k])) changed = true;
    if (changed) this.blocks = out;
    return changed;
  }

  /** One node at the top of the surface as blocks: its own, or new ones for what the browser made. */
  private readNode(node: ChildNode, byId: Map<string, Block>): Block[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(ZWSP, "");
      return t ? [textBlock("p", [{ kind: "text", text: t, marks: {} }])] : [];
    }
    if (!(node instanceof HTMLElement)) return [];
    const old = byId.get(node.dataset["id"] ?? "");
    if (old) byId.delete(node.dataset["id"] ?? "");
    if (isVoid(old)) return [old];
    if (old?.kind === "table") {
      const rows = old.rows.map((row, r) =>
        row.map((cell, c) => {
          const td = node.querySelector<HTMLElement>(`[data-cell="${r},${c}"]`);
          if (!td) return cell;
          const read = readInline(td);
          return sameInline(read, cell) ? cell : read;
        }),
      );
      return rows.every((row, r) => row.every((cell, c) => cell === old.rows[r]![c])) ? [old] : [{ ...old, rows }];
    }
    if (old?.kind === "code" || node.tagName === "PRE") {
      const text = codeText(node);
      if (old?.kind === "code") return old.text === text ? [old] : [{ ...old, text }];
      return [{ id: newId(), kind: "code", lang: "", text, wrap: null }];
    }
    const content = readInline(node);
    if (old && isText(old)) return sameInline(content, old.content) ? [old] : [{ ...old, content }];
    // an element the browser made: its own line, as plain text
    return [textBlock("p", content)];
  }

  // -------------------------------------------------------------------------
  // selection
  // -------------------------------------------------------------------------

  /** Where a DOM position is in the document. */
  private toPos(node: Node, offset: number): Pos | null {
    if (!this.root.contains(node)) return null;
    if (node === this.root) {
      const child = this.root.childNodes[offset] ?? null;
      if (!child) {
        const b = this.blocks.length - 1;
        return { b, o: sizeAt(this.blocks, { b, o: 0 }) };
      }
      const b = this.indexOf(child);
      return b < 0 ? null : { b, o: 0 };
    }
    let el: Node | null = node;
    while (el && el.parentNode !== this.root) el = el.parentNode;
    if (!el) return null;
    const b = this.indexOf(el);
    if (b < 0) return null;
    const block = this.blocks[b]!;
    if (block.kind === "table") {
      const td = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>("[data-cell]");
      if (!td) return { b, o: 0, cell: [0, 0] };
      const [r, c] = (td.dataset["cell"] ?? "0,0").split(",").map(Number) as [number, number];
      return { b, cell: [r, c], o: offsetIn(td, node, offset) };
    }
    if (isVoid(block)) return { b, o: 0 };
    return { b, o: Math.min(offsetIn(el as HTMLElement, node, offset), sizeAt(this.blocks, { b, o: 0 })) };
  }

  private indexOf(node: Node): number {
    const id = node instanceof HTMLElement ? node.dataset["id"] : undefined;
    if (id === undefined) return -1;
    return this.blocks.findIndex((b) => String(b.id) === id);
  }

  /** The DOM position for a place in the document. */
  private toDom(p: Pos): [Node, number] | null {
    const block = this.blocks[p.b];
    if (!block) return null;
    const el = this.elements.get(block);
    if (!el) return null;
    if (isVoid(block)) return [this.root, Math.max(0, Array.from(this.root.childNodes).indexOf(el))];
    let host: HTMLElement = el;
    if (block.kind === "table") {
      const td = el.querySelector<HTMLElement>(`[data-cell="${p.cell?.[0] ?? 0},${p.cell?.[1] ?? 0}"]`);
      if (!td) return null;
      host = td;
    }
    return domAt(host, p.o);
  }

  /** Reads the page's selection into the model, when it is in the surface. */
  private syncSelection(): boolean {
    const s = document.getSelection();
    if (!s || s.rangeCount === 0 || !s.anchorNode || !s.focusNode) return false;
    const anchor = this.toPos(s.anchorNode, s.anchorOffset);
    const focus = this.toPos(s.focusNode, s.focusOffset);
    if (!anchor || !focus) return false;
    // a selection from outside a table into it stops at the table's edge
    this.sel = { anchor, focus };
    return true;
  }

  /** Puts the page's selection (and the keyboard) where the model says. */
  private placeSelection(): void {
    const s = document.getSelection();
    const anchor = this.toDom(this.sel.anchor);
    const focus = this.toDom(this.sel.focus);
    if (!s || !anchor || !focus) return;
    const host = (focus[0] instanceof HTMLElement ? focus[0] : focus[0].parentElement)?.closest<HTMLElement>("[contenteditable='true']") ?? this.root;
    if (document.activeElement !== host) host.focus({ preventScroll: true });
    try {
      s.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
    } catch {
      /* a position the browser will not take: leave its own */
    }
    const target = focus[0] instanceof HTMLElement ? focus[0] : focus[0].parentElement;
    target?.scrollIntoView?.({ block: "nearest" });
  }

  private onSelectionChange(): void {
    if (this.destroyed || this.composing) return;
    const s = document.getSelection();
    if (!s?.anchorNode || !this.root.contains(s.anchorNode)) return;
    const before = this.sel;
    if (!this.syncSelection()) return;
    // moving away from where marks were chosen forgets them
    if (this.pending && comparePos(this.pending.at, this.sel.focus) !== 0) this.pending = null;
    if (before !== this.sel) this.emitState();
  }

  // -------------------------------------------------------------------------
  // changes
  // -------------------------------------------------------------------------

  /** Takes a step for undo before a change, unless it continues the typing just before. */
  private remember(typing: boolean): void {
    const now = Date.now();
    if (typing && now - this.lastTyping < COALESCE_MS && this.past.length) {
      this.lastTyping = now;
      return;
    }
    this.lastTyping = typing ? now : 0;
    this.past.push({ blocks: this.blocks, sel: this.sel });
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  /** Applies a change made on the model, draws it, and puts the selection back. */
  private apply(blocks: Block[], sel: Sel, record = true): void {
    if (record) this.remember(false);
    this.blocks = blocks.length ? blocks : [textBlock()];
    this.sel = { anchor: clampPos(this.blocks, sel.anchor), focus: clampPos(this.blocks, sel.focus) };
    this.pending = null;
    this.render();
    this.placeSelection();
    this.opts.onChange();
    this.emitState();
  }

  private undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push({ blocks: this.blocks, sel: this.sel });
    this.lastTyping = 0;
    this.apply(prev.blocks, prev.sel, false);
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push({ blocks: this.blocks, sel: this.sel });
    this.apply(next.blocks, next.sel, false);
  }

  private emitState(): void {
    if (this.stateFrame) return;
    const run = () => {
      this.stateFrame = 0;
      if (!this.destroyed) this.opts.onState(this.state());
    };
    this.stateFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  }

  state(): SurfaceState {
    const [from, to] = ordered(this.sel);
    const block = this.blocks[this.sel.focus.b];
    const flat = collapsed(this.sel);
    let marks: Marks = {};
    if (flat) {
      if (this.pending) marks = this.pending.marks;
      else if (block && isText(block)) marks = marksAt(block.content, this.sel.focus.o);
      else if (block?.kind === "table" && this.sel.focus.cell) marks = marksAt(block.rows[this.sel.focus.cell[0]]?.[this.sel.focus.cell[1]] ?? [], this.sel.focus.o);
    } else {
      for (const f of FLAGS) if (selectionHas(this.blocks, this.sel, (m) => !!m[f])) marks[f] = true;
      const colors = new Set<string>();
      selectionHas(this.blocks, this.sel, (m) => {
        colors.add(JSON.stringify(m.color ?? null));
        return true;
      });
      if (colors.size === 1) {
        const only = JSON.parse([...colors][0]!) as Marks["color"] | null;
        if (only) marks.color = only;
      }
    }
    let link: SurfaceState["link"] = null;
    const content = block && isText(block) ? block.content : block?.kind === "table" && this.sel.focus.cell ? (block.rows[this.sel.focus.cell[0]]?.[this.sel.focus.cell[1]] ?? []) : null;
    if (content && from.b === to.b && sameCell(from, to)) {
      const around = linkAround(content, this.sel.focus.o);
      if (around && (flat ? this.sel.focus.o > around.from && this.sel.focus.o < around.to : from.o >= around.from && to.o <= around.to)) link = { url: around.url, noEmbed: around.noEmbed };
    }
    const cell = block?.kind === "table" ? (this.sel.focus.cell ?? [0, 0]) : null;
    return {
      marks,
      kind: block ? block.kind : null,
      list: block && isText(block) ? (block.list ?? null) : null,
      wrap: block?.wrap ?? null,
      table: block?.kind === "table" && cell ? { row: cell[0], col: cell[1], rows: block.rows.length, cols: block.align.length, align: block.align[cell[1]] ?? null } : null,
      code: block?.kind === "code" ? { lang: block.lang } : null,
      link,
      collapsed: flat,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      selectedText: selectedRuns(this.blocks, this.sel)
        .map((r) => (r.kind === "text" ? r.text : r.label))
        .join(""),
    };
  }

  // -------------------------------------------------------------------------
  // the browser's input
  // -------------------------------------------------------------------------

  private onBeforeInput(e: InputEvent): void {
    if (this.composing || e.isComposing) return;
    this.syncSelection();
    const sel = this.sel;
    const [from, to] = ordered(sel);
    const across = from.b !== to.b || !sameCell(from, to);
    const flat = collapsed(sel);
    const block = this.blocks[from.b];
    switch (e.inputType) {
      case "insertText":
      case "insertReplacementText": {
        const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
        if (data === " " && flat && this.shortcut()) {
          e.preventDefault();
          return;
        }
        // Typing over a selection that spans blocks, with marks chosen at
        // the caret, or just after a link or inline code (whose end the
        // browser would stretch over the new words), is done here; the rest
        // is the browser's own.
        if (across || this.pending || isVoid(block) || (flat && this.atEdgeOfLinkOrCode(from))) {
          e.preventDefault();
          this.typeText(data);
        }
        return;
      }
      case "insertParagraph":
      case "insertLineBreak":
        e.preventDefault();
        this.enter();
        return;
      case "deleteContentBackward":
      case "deleteContentForward":
      case "deleteWordBackward":
      case "deleteWordForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteByCut":
      case "deleteContent": {
        const back = !e.inputType.endsWith("Forward");
        if (!flat && across) {
          e.preventDefault();
          const edit = deleteRange(this.blocks, sel);
          this.apply(edit.blocks, edit.sel);
          return;
        }
        if (!flat) return;
        const size = sizeAt(this.blocks, from);
        if (from.cell) {
          // a cell's edges are walls: nothing joins across them
          if ((back && from.o === 0) || (!back && from.o >= size)) e.preventDefault();
          return;
        }
        if (back && from.o === 0) {
          e.preventDefault();
          const edit = joinBackward(this.blocks, from.b);
          this.apply(edit.blocks, edit.sel);
          return;
        }
        if (!back && from.o >= size) {
          e.preventDefault();
          const edit = joinForward(this.blocks, from.b);
          this.apply(edit.blocks, edit.sel);
        }
        return;
      }
      case "historyUndo":
        e.preventDefault();
        this.undo();
        return;
      case "historyRedo":
        e.preventDefault();
        this.redo();
        return;
      case "formatBold":
        e.preventDefault();
        this.command({ t: "mark", flag: "b" });
        return;
      case "formatItalic":
        e.preventDefault();
        this.command({ t: "mark", flag: "i" });
        return;
      case "formatUnderline":
        e.preventDefault();
        this.command({ t: "mark", flag: "u" });
        return;
      case "formatStrikeThrough":
        e.preventDefault();
        this.command({ t: "mark", flag: "s" });
        return;
      case "insertFromPaste":
      case "insertFromPasteAsQuotation":
      case "insertFromDrop":
      case "insertFromYank":
        // paste is handled on its own event; a drop would move DOM the model does not know
        e.preventDefault();
        return;
      default:
        // the browser's own formatting would draw styles the model cannot read
        if (e.inputType.startsWith("format") || e.inputType === "insertOrderedList" || e.inputType === "insertUnorderedList" || e.inputType === "insertHorizontalRule") e.preventDefault();
    }
  }

  private onInput(): void {
    if (this.destroyed) return;
    const before: Snapshot = { blocks: this.blocks, sel: this.sel };
    if (!this.readBack()) return;
    // the step for undo is the document as it was before this typing
    const now = Date.now();
    if (!(now - this.lastTyping < COALESCE_MS && this.past.length)) {
      this.past.push(before);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.lastTyping = now;
    if (!this.composing) {
      this.syncSelection();
      this.tidy();
    }
    this.opts.onChange();
    this.emitState();
  }

  /**
   * Draws again the blocks whose page no longer looks as the model would draw
   * it (the browser added a <b>, a <div>, a stray <br>), keeping the caret.
   */
  private tidy(): void {
    let dirty = false;
    for (const block of this.blocks) {
      const el = this.elements.get(block);
      if (!el || !el.isConnected) {
        dirty = true;
        continue;
      }
      // a file's frame holds what the editor drew in it, which is not the surface's to redraw
      if (isVoid(block)) continue;
      const fresh = this.draw(block);
      if (fresh.innerHTML !== el.innerHTML) {
        this.elements.delete(block);
        dirty = true;
      }
    }
    // an element left over from the browser's own editing
    if (Array.from(this.root.childNodes).some((n) => !(n instanceof HTMLElement) || !n.dataset["id"])) dirty = true;
    if (!dirty) return;
    this.syncSelection();
    this.render();
    this.placeSelection();
  }

  private onCompositionStart(): void {
    this.syncSelection();
    const [from, to] = ordered(this.sel);
    if (from.b !== to.b || !sameCell(from, to)) {
      // an input method writing over several blocks: they are joined first
      const edit = deleteRange(this.blocks, this.sel);
      this.apply(edit.blocks, edit.sel);
    }
    this.composing = true;
    const p = this.sel.focus;
    this.composeFrom = { b: p.b, cell: p.cell, text: this.textOf(p) };
  }

  private onCompositionEnd(): void {
    this.composing = false;
    const from = this.composeFrom;
    this.composeFrom = null;
    this.readBack();
    this.syncSelection();
    // marks chosen before the word was composed go on what it inserted
    if (this.pending && from && from.b === this.sel.focus.b) {
      const now = this.textOf(this.sel.focus);
      let start = 0;
      while (start < from.text.length && start < now.length && from.text[start] === now[start]) start += 1;
      let end = 0;
      while (end < from.text.length - start && end < now.length - start && from.text[from.text.length - 1 - end] === now[now.length - 1 - end]) end += 1;
      const inserted: [number, number] = [start, now.length - end];
      const marks = this.pending.marks;
      if (inserted[1] > inserted[0]) {
        const blocks = this.blocks.slice();
        const block = blocks[from.b]!;
        if (isText(block)) blocks[from.b] = { ...block, content: mapMarks(block.content, inserted[0], inserted[1], () => marks) };
        else if (block.kind === "table" && from.cell) {
          const rows = block.rows.map((r) => r.slice());
          rows[from.cell[0]]![from.cell[1]] = mapMarks(rows[from.cell[0]]![from.cell[1]]!, inserted[0], inserted[1], () => marks);
          blocks[from.b] = { ...block, rows };
        }
        this.apply(blocks, this.sel, false);
        this.pending = { at: this.sel.focus, marks };
        return;
      }
    }
    this.tidy();
    this.opts.onChange();
    this.emitState();
  }

  /** Whether the caret sits just after a link or a code span, where typing should leave it behind. */
  private atEdgeOfLinkOrCode(p: Pos): boolean {
    const block = this.blocks[p.b];
    const content = block && isText(block) ? block.content : block?.kind === "table" && p.cell ? (block.rows[p.cell[0]]?.[p.cell[1]] ?? []) : null;
    if (!content || p.o === 0) return false;
    const before = sliceMarks(content, p.o - 1);
    const after = sliceMarks(content, p.o);
    if (!before) return false;
    const linkEnds = !!before.link && (!after?.link || after.link.url !== before.link.url);
    const codeEnds = !!before.code && !after?.code;
    return linkEnds || codeEnds;
  }

  /** The text of the block or cell a position is in, atoms as one character each. */
  private textOf(p: Pos): string {
    const block = this.blocks[p.b];
    if (!block) return "";
    const flat = (content: Inline[]) => content.map((r) => (r.kind === "text" ? r.text : "\u0000")).join("");
    if (block.kind === "code") return block.text;
    if (block.kind === "table") return flat(block.rows[p.cell?.[0] ?? 0]?.[p.cell?.[1] ?? 0] ?? []);
    return isText(block) ? flat(block.content) : "";
  }

  private typeText(text: string): void {
    let blocks = this.blocks;
    let sel = this.sel;
    if (!collapsed(sel)) {
      const edit = deleteRange(blocks, sel);
      blocks = edit.blocks;
      sel = edit.sel;
    }
    const at = sel.focus;
    const block = blocks[at.b];
    const content = block && isText(block) ? block.content : block?.kind === "table" && at.cell ? (block.rows[at.cell[0]]?.[at.cell[1]] ?? []) : [];
    const marks = this.pending?.marks ?? marksAt(content, at.o);
    const keep = this.pending?.marks;
    const edit = insertAt(blocks, at, [{ kind: "text", text, marks }]);
    this.remember(true);
    this.apply(edit.blocks, edit.sel, false);
    // marks chosen at the caret last for as long as the typing goes on there
    if (keep) this.pending = { at: this.sel.focus, marks: keep };
  }

  private enter(): void {
    const [from] = ordered(this.sel);
    let blocks = this.blocks;
    let at: Pos = from;
    if (!collapsed(this.sel)) {
      const edit = deleteRange(blocks, this.sel);
      blocks = edit.blocks;
      at = edit.sel.focus;
    }
    const block = blocks[at.b];
    if (block?.kind === "table" && at.cell) {
      // Enter in a table moves down a row, adding one at the bottom
      const [r, c] = at.cell;
      let next = blocks;
      if (r + 1 >= block.rows.length) next = editTable(blocks, at.b, { kind: "addRow", at: block.rows.length });
      this.apply(next, caret(at.b, 0, [r + 1, c]));
      return;
    }
    // a line typed as ```js or --- becomes a code block or a rule on Enter
    if (isText(block) && block.kind === "p" && !block.wrap?.startsWith("q")) {
      const line = block.content.length === 1 && block.content[0]!.kind === "text" && !Object.keys(block.content[0]!.marks).length ? block.content[0]!.text : block.content.length === 0 ? "" : null;
      const fence = line !== null ? /^```([a-zA-Z0-9_+-]*)$/.exec(line) : null;
      if (fence && at.o === line!.length) {
        const out = blocks.slice();
        out[at.b] = { id: newId(), kind: "code", lang: fence[1] ?? "", text: "", wrap: block.wrap };
        if (!out[at.b + 1] || !isText(out[at.b + 1])) out.splice(at.b + 1, 0, textBlock("p", [], block.wrap));
        this.apply(out, caret(at.b, 0));
        return;
      }
      if (line === "---" && at.o === 3) {
        const out = blocks.slice();
        out.splice(at.b, 1, { id: newId(), kind: "hr", wrap: block.wrap }, textBlock("p", [], block.wrap));
        this.apply(out, caret(at.b + 1, 0));
        return;
      }
    }
    const edit = splitAt(blocks, at);
    this.apply(edit.blocks, edit.sel);
  }

  /**
   * Markdown typed at the start of a line, on the space after it, turns the
   * line into what it says: "- " a list, "1. " a numbered one, "[] " a
   * checklist, "# " a heading, "> " a quote, "-# " small print.
   */
  private shortcut(): boolean {
    const at = this.sel.focus;
    const block = this.blocks[at.b];
    if (!isText(block) || block.kind !== "p" || at.cell) return false;
    const before = block.content.map((r) => (r.kind === "text" ? r.text : "\u0000")).join("").slice(0, at.o);
    let make: ((b: TextBlock) => TextBlock) | null = null;
    const list = (ordered: boolean, task: boolean, checked: boolean, start: number | null) => (b: TextBlock): TextBlock => ({ ...b, kind: "li", wrap: b.wrap === "quote" ? null : b.wrap, list: { ordered, task, checked, indent: 0, start } });
    let m: RegExpExecArray | null;
    if (/^[-*]$/.test(before)) make = list(false, false, false, null);
    else if ((m = /^(\d{1,9})[.)]$/.exec(before))) make = list(true, false, false, Number(m[1]) === 1 ? null : Number(m[1]));
    else if (/^\[ ?\]$/.test(before)) make = list(false, true, false, null);
    else if (/^\[[xX]\]$/.test(before)) make = list(false, true, true, null);
    else if ((m = /^(#{1,6})$/.exec(before))) {
      const kind = `h${m[1]!.length}` as TextKind;
      make = (b) => ({ ...b, kind, wrap: b.wrap === "quote" ? null : b.wrap });
    } else if (before === ">") make = (b) => ({ ...b, wrap: "quote" });
    else if (before === "-#") make = (b) => ({ ...b, kind: "subtext" });
    if (!make) return false;
    const trimmed = spliceInline(block.content, 0, at.o, []);
    const out = this.blocks.slice();
    out[at.b] = make({ ...block, content: trimmed });
    this.apply(out, caret(at.b, 0));
    return true;
  }

  // -------------------------------------------------------------------------
  // keys, clicks, clipboard
  // -------------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && !e.altKey) {
      const flag = ({ b: "b", i: "i", u: "u", e: "code" } as Record<string, Flag>)[key];
      if (flag && !e.shiftKey) {
        stop();
        this.command({ t: "mark", flag });
        return;
      }
      if (e.shiftKey && key === "x") {
        stop();
        this.command({ t: "mark", flag: "s" });
        return;
      }
      if (key === "k") {
        stop();
        this.opts.onLinkKey?.();
        return;
      }
      if (key === "z") {
        stop();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (key === "y") {
        stop();
        this.redo();
        return;
      }
      if (key === "\\") {
        stop();
        this.command({ t: "clear" });
        return;
      }
      if (e.shiftKey && (key === "7" || key === "8" || key === "9")) {
        stop();
        this.command({ t: "list", type: key === "7" ? "ordered" : key === "8" ? "bullet" : "task" });
        return;
      }
      if (key === "enter") {
        stop();
        this.opts.onSubmit?.();
        return;
      }
    }
    if (mod && e.altKey && /^[0-6]$/.test(key)) {
      stop();
      this.command({ t: "kind", kind: key === "0" ? "p" : (`h${key}` as "h1") });
      return;
    }
    if (e.key === "Escape") {
      stop();
      this.opts.onEscape?.();
      return;
    }
    // A table's cells are fields of their own: up from its top row and down
    // from its bottom row lead out of it, to the lines around it.
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mod && !e.altKey && !e.shiftKey) {
      this.syncSelection();
      const p = this.sel.focus;
      const block = this.blocks[p.b];
      if (block?.kind === "table" && p.cell) {
        const down = e.key === "ArrowDown";
        const [r, c] = p.cell;
        if (down ? r < block.rows.length - 1 : r > 0) {
          stop();
          const next = (block.rows[down ? r + 1 : r - 1]?.[c] ?? []) as Inline[];
          this.sel = caret(p.b, Math.min(p.o, inlineLength(next)), [down ? r + 1 : r - 1, c]);
          this.placeSelection();
          this.emitState();
          return;
        }
        stop();
        let blocks = this.blocks;
        let target = down ? p.b + 1 : p.b - 1;
        if (target < 0 || target >= blocks.length) {
          // nothing there yet: a line to go on writing in
          blocks = blocks.slice();
          blocks.splice(down ? p.b + 1 : 0, 0, textBlock("p", [], block.wrap));
          target = down ? p.b + 1 : 0;
          this.apply(blocks, caret(target, 0));
          return;
        }
        this.sel = caret(target, down ? 0 : sizeAt(blocks, { b: target, o: 0 }));
        this.placeSelection();
        this.emitState();
        return;
      }
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      this.syncSelection();
      const block = this.blocks[this.sel.focus.b];
      if (block?.kind === "table") {
        stop();
        this.moveCell(e.shiftKey ? -1 : 1);
        return;
      }
      if (isText(block) && block.kind === "li") {
        stop();
        this.command({ t: "indent", delta: e.shiftKey ? -1 : 1 });
      }
      // anywhere else Tab leaves the editor, as it should
    }
  }

  private moveCell(step: 1 | -1): void {
    const p = this.sel.focus;
    const block = this.blocks[p.b];
    if (block?.kind !== "table" || !p.cell) return;
    const cols = block.align.length;
    let k = p.cell[0] * cols + p.cell[1] + step;
    let blocks = this.blocks;
    if (k >= block.rows.length * cols) {
      blocks = editTable(blocks, p.b, { kind: "addRow", at: block.rows.length });
    }
    if (k < 0) k = 0;
    const r = Math.floor(k / cols);
    const c = k % cols;
    const cell = (blocks[p.b] as TableBlock).rows[r]?.[c] ?? [];
    this.apply(blocks, { anchor: { b: p.b, cell: [r, c], o: 0 }, focus: { b: p.b, cell: [r, c], o: inlineLength(cell) } }, blocks !== this.blocks);
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const li = target?.closest<HTMLElement>("[data-task]");
    if (!li || li !== target) return;
    // the box is drawn in the item's start padding: a press there ticks it
    const box = li.getBoundingClientRect();
    const rtl = getComputedStyle(li).direction === "rtl";
    const pad = Number.parseFloat(getComputedStyle(li).paddingInlineStart || "0");
    const x = rtl ? box.right - e.clientX : e.clientX - box.left;
    if (x > pad) return;
    const b = this.indexOf(li);
    if (b < 0) return;
    e.preventDefault();
    this.apply(toggleChecked(this.blocks, b), this.sel);
  }

  private onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    this.syncSelection();
    // a copied picture or file goes to the editor, where there is one that takes files
    if (this.opts.onPasteFiles && data.files.length > 0) {
      this.opts.onPasteFiles(Array.from(data.files));
      return;
    }
    const text = (data.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    if (!text) return;
    let blocks = this.blocks;
    let sel = this.sel;
    if (!collapsed(sel)) {
      const edit = deleteRange(blocks, sel);
      blocks = edit.blocks;
      sel = edit.sel;
    }
    const at = sel.focus;
    const here = blocks[at.b];
    // Into a cell or a code block, and for a single line, the words go in as
    // they are; several lines are read as markdown and become blocks here.
    if (here?.kind === "code" || at.cell || !text.includes("\n")) {
      const runs = at.cell || here?.kind === "code" ? [{ kind: "text" as const, text, marks: {} }] : inlineFromMarkdown(text, this.opts.names);
      const edit = insertAt(blocks, at, runs);
      this.apply(edit.blocks, edit.sel);
      return;
    }
    // Read as markdown, which drops blank lines at either end and spaces at
    // the very end; a paste keeps its edges, so they are put back.
    const pasted = fromMarkdown(text, this.opts.names, this.opts.read).blocks;
    const lead = /^\n*/.exec(text)?.[0].length ?? 0;
    const trail = /\n*$/.exec(text)?.[0].length ?? 0;
    const spaces = /[ \t]+\n*$/.exec(text)?.[0].replace(/\n/g, "") ?? "";
    const end = pasted[pasted.length - 1];
    if (spaces && isText(end)) pasted[pasted.length - 1] = { ...end, content: normalize([...end.content, { kind: "text", text: spaces, marks: {} }]) };
    for (let k = 0; k < lead; k++) pasted.unshift(textBlock());
    for (let k = 0; k < trail; k++) pasted.push(textBlock());
    if (!isText(here)) {
      const out = blocks.slice();
      out.splice(at.b + 1, 0, ...pasted);
      this.apply(out, caret(at.b + pasted.length, sizeAt(out, { b: at.b + pasted.length, o: 0 })));
      return;
    }
    // the first pasted line joins the line it lands in, the last one takes what came after the caret
    const len = inlineLength(here.content);
    const head = spliceInline(here.content, at.o, len, []);
    const tail = spliceInline(here.content, 0, at.o, []);
    const first = pasted[0]!;
    const last = pasted[pasted.length - 1]!;
    const out = blocks.slice();
    const merged: Block[] = [];
    if (isText(first)) merged.push({ ...here, content: normalize([...head, ...first.content]), kind: here.kind === "p" ? first.kind : here.kind, list: here.kind === "p" ? first.list : here.list, wrap: here.wrap ?? first.wrap });
    else merged.push({ ...here, content: head }, first);
    merged.push(...pasted.slice(1, -1));
    let caretAt: Pos;
    if (pasted.length > 1) {
      if (isText(last)) {
        merged.push({ ...last, content: normalize([...last.content, ...tail]) });
        caretAt = { b: at.b + merged.length - 1, o: inlineLength(last.content) };
      } else {
        merged.push(last, textBlock("p", tail, here.wrap));
        caretAt = { b: at.b + merged.length - 1, o: 0 };
      }
    } else {
      const only = merged[0] as TextBlock;
      merged[0] = { ...only, content: normalize([...only.content, ...tail]) };
      caretAt = { b: at.b, o: inlineLength(head) + (isText(first) ? inlineLength(first.content) : 0) };
    }
    out.splice(at.b, 1, ...merged);
    this.apply(out, caret(caretAt.b, caretAt.o));
  }

  /** Copying gives the selection's markdown as text, so it pastes formatted into the message box too. */
  private onCopy(e: ClipboardEvent, cut: boolean): void {
    this.syncSelection();
    if (collapsed(this.sel) || !e.clipboardData) return;
    const [from, to] = ordered(this.sel);
    let md: string;
    if (from.b === to.b && sameCell(from, to)) {
      const runs = selectedRuns(this.blocks, this.sel);
      md = toMarkdown([textBlock("p", runs)]);
    } else {
      const picked = this.blocks.slice(from.b, to.b + 1).map((b, k, all) => {
        if (!isText(b)) return b;
        const len = inlineLength(b.content);
        const s = k === 0 ? from.o : 0;
        const e2 = k === all.length - 1 ? to.o : len;
        return { ...b, content: spliceInline(spliceInline(b.content, e2, len, []), 0, s, []) };
      });
      md = toMarkdown(picked);
    }
    e.preventDefault();
    e.clipboardData.setData("text/plain", md);
    const range = document.getSelection()?.getRangeAt(0);
    if (range) {
      const holder = document.createElement("div");
      holder.appendChild(range.cloneContents());
      e.clipboardData.setData("text/html", holder.innerHTML);
    }
    if (cut) {
      const edit = deleteRange(this.blocks, this.sel);
      this.apply(edit.blocks, edit.sel);
    }
  }

  // -------------------------------------------------------------------------
  // commands from the toolbar
  // -------------------------------------------------------------------------

  command(cmd: Command): void {
    if (this.composing) return;
    // a toolbar button pressed while the page's selection is elsewhere acts on the last one known here
    const s = document.getSelection();
    if (s?.anchorNode && this.root.contains(s.anchorNode)) this.syncSelection();
    const sel = this.sel;
    const [from, to] = ordered(sel);
    const flat = collapsed(sel);
    const block = this.blocks[from.b];
    switch (cmd.t) {
      case "mark": {
        if (flat) {
          // nothing selected: the next typing takes the mark, as in any word processor
          const content = block && isText(block) ? block.content : block?.kind === "table" && from.cell ? (block.rows[from.cell[0]]?.[from.cell[1]] ?? []) : null;
          if (!content) return;
          const cur = this.pending?.marks ?? marksAt(content, from.o);
          this.pending = { at: from, marks: withMark(cur, cmd.flag, !cur[cmd.flag]) };
          this.placeSelection();
          this.emitState();
          return;
        }
        const on = !selectionHas(this.blocks, sel, (m) => !!m[cmd.flag]);
        this.apply(mapSelection(this.blocks, sel, (m) => withMark(m, cmd.flag, on)), sel);
        return;
      }
      case "color": {
        if (flat) {
          const content = block && isText(block) ? block.content : block?.kind === "table" && from.cell ? (block.rows[from.cell[0]]?.[from.cell[1]] ?? []) : null;
          if (!content) return;
          const cur = this.pending?.marks ?? marksAt(content, from.o);
          this.pending = { at: from, marks: withColor(cur, cmd.part, cmd.value) };
          this.placeSelection();
          this.emitState();
          return;
        }
        this.apply(mapSelection(this.blocks, sel, (m) => withColor(m, cmd.part, cmd.value)), sel);
        return;
      }
      case "link": {
        const link = cmd.url ? { url: cmd.url, noEmbed: !!cmd.noEmbed } : null;
        const content = block && isText(block) ? block.content : block?.kind === "table" && from.cell ? (block.rows[from.cell[0]]?.[from.cell[1]] ?? []) : null;
        if (flat && content) {
          const around = linkAround(content, from.o);
          if (around && from.o > around.from && from.o < around.to) {
            // the caret is in a link: change or take off the whole link
            const s2: Sel = { anchor: { ...from, o: around.from }, focus: { ...from, o: around.to } };
            this.apply(mapSelection(this.blocks, s2, (m) => withLink(m, link)), s2);
            return;
          }
          if (link) {
            // nothing selected: the link goes in with its words, or its address as its words
            const words = cmd.text?.trim() || link.url;
            const marks = withLink(marksAt(content, from.o), link);
            const edit = insertAt(this.blocks, from, [{ kind: "text", text: words, marks }]);
            this.apply(edit.blocks, edit.sel);
          }
          return;
        }
        this.apply(mapSelection(this.blocks, sel, (m) => withLink(m, link)), sel);
        return;
      }
      case "kind":
        this.apply(setKind(this.blocks, sel, cmd.kind), sel);
        return;
      case "list":
        this.apply(toggleList(this.blocks, sel, cmd.type), sel);
        return;
      case "indent":
        this.apply(indentBy(this.blocks, sel, cmd.delta), sel);
        return;
      case "check":
        this.apply(toggleChecked(this.blocks, from.b), sel);
        return;
      case "wrap": {
        const edit = toggleWrap(this.blocks, sel, cmd.wrap);
        this.apply(edit.blocks, edit.sel);
        return;
      }
      case "code": {
        const edit = toggleCode(this.blocks, sel);
        this.apply(edit.blocks, edit.sel);
        return;
      }
      case "lang": {
        if (block?.kind !== "code") return;
        const out = this.blocks.slice();
        out[from.b] = { ...block, lang: cmd.lang.replace(/[^a-zA-Z0-9_+-]/g, "").slice(0, 32) };
        this.apply(out, sel);
        return;
      }
      case "table": {
        const edit = insertBlock(this.blocks, sel, emptyTable(Math.max(2, cmd.rows), Math.max(1, cmd.cols)));
        this.apply(edit.blocks, edit.sel);
        return;
      }
      case "tableOp": {
        if (block?.kind !== "table") return;
        const cell = from.cell ?? [0, 0];
        if (cmd.op.kind === "delete") {
          const out = this.blocks.slice();
          out.splice(from.b, 1);
          if (!isText(out[from.b])) out.splice(from.b, 0, textBlock("p", [], block.wrap));
          this.apply(out, caret(from.b, 0));
          return;
        }
        const out = editTable(this.blocks, from.b, cmd.op);
        const t = out[from.b];
        if (t?.kind !== "table") {
          this.apply(out, caret(Math.min(from.b, out.length - 1), 0));
          return;
        }
        let [r, c] = cell;
        if (cmd.op.kind === "addRow") r = cmd.op.at;
        if (cmd.op.kind === "addCol") c = cmd.op.at;
        r = Math.min(r, t.rows.length - 1);
        c = Math.min(c, t.align.length - 1);
        this.apply(out, caret(from.b, 0, [r, c]));
        return;
      }
      case "hr": {
        const edit = insertBlock(this.blocks, sel, { id: newId(), kind: "hr", wrap: null });
        this.apply(edit.blocks, edit.sel);
        return;
      }
      case "file": {
        const edit = insertBlock(this.blocks, sel, { id: newId(), kind: "file", file: cmd.file, name: cmd.name, wrap: null });
        this.apply(edit.blocks, edit.sel);
        return;
      }
      case "fileWidth": {
        const at = this.blocks.findIndex((b) => b.id === cmd.key);
        const block = this.blocks[at];
        if (!block || block.kind !== "file") return;
        const width = fileWidth(cmd.width);
        if (width === block.width) return;
        const out = this.blocks.slice();
        const next: FileBlock = { ...block };
        if (width) next.width = width;
        else delete next.width;
        out[at] = next;
        this.apply(out, this.sel);
        return;
      }
      case "removeBlock": {
        const at = this.blocks.findIndex((b) => b.id === cmd.key);
        if (at < 0) return;
        const out = this.blocks.slice();
        out.splice(at, 1);
        // the caret goes where the block was: the start of what took its place, or the end of the line before
        const next = out[at] && !isVoid(out[at]) ? caret(at, 0) : at > 0 ? caret(at - 1, sizeAt(out, { b: at - 1, o: 0 })) : caret(0, 0);
        this.apply(out, next);
        return;
      }
      case "clear":
        if (flat) {
          this.pending = { at: from, marks: {} };
          this.emitState();
          return;
        }
        this.apply(clearFormatting(this.blocks, sel), sel);
        return;
      case "undo":
        this.undo();
        return;
      case "redo":
        this.redo();
        return;
      case "text": {
        this.syncSelection();
        this.typeText(cmd.text);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** The marks of the character at an offset, or null past the end. */
function sliceMarks(content: Inline[], offset: number): Marks | null {
  let at = 0;
  for (const r of content) {
    const len = r.kind === "text" ? r.text.length : 1;
    if (offset < at + len) return r.marks;
    at += len;
  }
  return null;
}

function set(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** A code block's text, without the line break that holds its last line open. */
function codeText(el: HTMLElement): string {
  let text = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
    else if (n instanceof HTMLBRElement) text += "\n";
    else n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  // the last <br> only holds the line open
  if (el.lastChild instanceof HTMLBRElement) text = text.slice(0, -1);
  return text.replace(ZWSP, "").replace(/ /g, " ");
}

/** The runs inside a block or cell, marks read from the elements around each piece of text. */
function readInline(host: HTMLElement): Inline[] {
  const out: Inline[] = [];
  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(ZWSP, "").replace(/ /g, " ").replace(/\n/g, " ");
      if (text) out.push({ kind: "text", text, marks });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset["atom"] !== undefined) {
      const img = node.querySelector("img");
      out.push({ kind: "atom", atom: (node.dataset["kind"] as Inline extends { atom: infer A } ? A : never) ?? "user", raw: node.dataset["atom"] ?? "", label: img?.alt ?? node.textContent ?? "", img: img?.src, marks });
      return;
    }
    if (node.tagName === "BR" || node.dataset["skip"] !== undefined) return;
    let m = marks;
    switch (node.tagName) {
      case "STRONG":
      case "B":
        m = { ...m, b: true };
        break;
      case "EM":
      case "I":
        m = { ...m, i: true };
        break;
      case "U":
      case "INS":
        m = { ...m, u: true };
        break;
      case "S":
      case "STRIKE":
      case "DEL":
        m = { ...m, s: true };
        break;
      case "MARK":
        m = { ...m, mark: true };
        break;
      case "SUP":
        m = { ...m, sup: true };
        break;
      case "SUB":
        m = { ...m, sub: true };
        break;
      case "CODE":
        m = { ...m, code: true };
        break;
      default:
        break;
    }
    const kind = node.dataset["m"];
    if (kind === "spoiler") m = { ...m, spoiler: true };
    else if (kind === "color") m = { ...m, color: { fg: node.dataset["fg"] ?? null, bg: node.dataset["bg"] ?? null } };
    else if (kind === "link") m = withLink(m, { url: node.dataset["url"] ?? "", noEmbed: node.dataset["quiet"] !== undefined });
    node.childNodes.forEach((child) => walk(child, m));
  };
  host.childNodes.forEach((child) => walk(child, {}));
  return normalize(out);
}

function sameInline(a: Inline[], b: Inline[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, k) => {
    const o = b[k]!;
    if (r.kind !== o.kind || !sameMarks(r.marks, o.marks)) return false;
    return r.kind === "text" ? r.text === (o as typeof r).text : r.raw === (o as typeof r).raw;
  });
}

/** The offset, in the document's characters, of a DOM position inside a block or cell. */
function offsetIn(host: HTMLElement, node: Node, offset: number): number {
  let count = 0;
  let done = false;
  const target = node.nodeType === Node.TEXT_NODE ? node : (node.childNodes[offset] ?? null);
  const walk = (n: Node): void => {
    if (done) return;
    if (n === target && n !== node) {
      done = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? "";
      if (n === node) {
        count += text.slice(0, offset).replace(ZWSP, "").length;
        done = true;
        return;
      }
      count += text.replace(ZWSP, "").length;
      return;
    }
    if (n instanceof HTMLElement && n.dataset["atom"] !== undefined) {
      count += 1;
      return;
    }
    for (const child of Array.from(n.childNodes)) {
      walk(child);
      if (done) return;
    }
  };
  if (node === host && target === null) {
    // after everything in the host
    host.childNodes.forEach((c) => walk(c));
    return count;
  }
  for (const child of Array.from(host.childNodes)) {
    walk(child);
    if (done) break;
  }
  return count;
}

/** The DOM position of a character offset inside a block or cell. */
function domAt(host: HTMLElement, offset: number): [Node, number] {
  let left = offset;
  let result: [Node, number] | null = null;
  let lastText: Text | null = null;
  const walk = (n: Node): void => {
    if (result) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? "").length;
      if (left <= len) {
        result = [n, left];
        return;
      }
      left -= len;
      lastText = n as Text;
      return;
    }
    if (n instanceof HTMLElement && n.dataset["atom"] !== undefined) {
      const parent = n.parentNode!;
      const at = Array.from(parent.childNodes).indexOf(n as ChildNode);
      if (left === 0) {
        result = [parent, at];
        return;
      }
      left -= 1;
      if (left === 0 && !n.nextSibling) result = [parent, at + 1];
      return;
    }
    for (const child of Array.from(n.childNodes)) {
      walk(child);
      if (result) return;
    }
  };
  for (const child of Array.from(host.childNodes)) {
    walk(child);
    if (result) break;
  }
  if (result) return result;
  const text = lastText as Text | null;
  if (text) return [text, (text.textContent ?? "").length];
  // an empty block: before its placeholder <br>
  return [host, 0];
}

export type { AlertKind };
