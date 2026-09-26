import type { AlertKind, Align } from "@/markdown/ast";
import { FALLBACK_SURFACE, paintColor, surfaceOf, type Surface } from "@/markdown/colors";
import { fromMarkdown, inlineFromMarkdown, toMarkdown, type AtomNames } from "./markdown";
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
  kind: TextKind | "code" | "hr" | "table" | null;
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
  | { t: "clear" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "text"; text: string };

interface Snapshot {
  blocks: Block[];
  sel: Sel;
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
  private destroyed = false;
  private readonly listeners: [EventTarget, string, EventListener][] = [];

  constructor(root: HTMLElement, opts: SurfaceOptions) {
    this.root = root;
    this.opts = opts;
    root.contentEditable = "true";
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");
    root.spellcheck = true;
    this.on(root, "beforeinput", (e) => this.onBeforeInput(e as InputEvent));
    this.on(root, "input", () => this.onInput());
    this.on(root, "compositionstart", () => this.onCompositionStart());
    this.on(root, "compositionend", () => this.onCompositionEnd());
    this.on(root, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    this.on(root, "paste", (e) => this.onPaste(e as ClipboardEvent));
    this.on(root, "copy", (e) => this.onCopy(e as ClipboardEvent, false));
    this.on(root, "cut", (e) => this.onCopy(e as ClipboardEvent, true));
    this.on(root, "click", (e) => this.onClick(e as MouseEvent));
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
    const loaded = fromMarkdown(markdown, this.opts.names);
    this.blocks = loaded.blocks;
    const last = this.blocks.length - 1;
    this.sel = caret(last, sizeAt(this.blocks, { b: last, o: 0 }));
    this.past = [];
    this.future = [];
    this.render();
    return loaded.simplified;
  }

  markdown(): string {
    return toMarkdown(this.blocks);
  }

  focus(): void {
    this.placeSelection();
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
    this.blocks.forEach((block, k) => {
      let el = this.elements.get(block);
      if (!el) el = this.draw(block);
      next.set(block, el);
      this.decorate(el, block, k, counters);
      children.push(el);
    });
    this.elements = next;
    const current = Array.from(this.root.childNodes);
    if (current.length !== children.length || current.some((n, k) => n !== children[k])) this.root.replaceChildren(...children);
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
    if (old?.kind === "hr") return [old];
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
    if (block.kind === "hr") return { b, o: 0 };
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
    if (block.kind === "hr") return [this.root, Math.max(0, Array.from(this.root.childNodes).indexOf(el))];
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
        if (across || this.pending || block?.kind === "hr" || (flat && this.atEdgeOfLinkOrCode(from))) {
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
      if (block.kind === "hr") continue;
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
    if (/^[-*+]$/.test(before)) make = list(false, false, false, null);
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
    const pasted = fromMarkdown(text, this.opts.names).blocks;
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
