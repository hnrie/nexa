import type { AlertKind, Align, Node, RenderCtx } from "@/markdown/ast";
import { formatColorSpec } from "@/markdown/colors";
import { fileLine, misleadingLabel, parse, RE_ALERT, RE_FOOTNOTE_DEF, RE_HEADING, RE_HR, RE_LIST, trimUrl } from "@/markdown/parse";
import { shortcodeToEmoji } from "@/lib/shortcodes";
import { formatStamp } from "@/lib/time";
import { t } from "@/i18n";
import { MAX_INDENT, isText, newId, normalize, sameMarks, textBlock, withColor, type Block, type Inline, type Marks, type TextBlock, type Wrap } from "./model";

// ---------------------------------------------------------------------------
// markdown -> the editor's blocks, through the parser's own AST
// ---------------------------------------------------------------------------

/** What turns ids into the names and pictures the editor shows for mentions and emoji. */
export type AtomNames = Pick<RenderCtx, "users" | "channels" | "roles" | "emojiUrl">;

export interface Loaded {
  blocks: Block[];
  /**
   * The message had something the editor shows one level deep only (a quote
   * or callout inside a callout, a folded section inside another); inserting
   * it again writes that part in the simpler form.
   */
  simplified: boolean;
}

/** How a note's text is read: with its file lines as files, and as long as a note may be. */
export interface ReadOptions {
  files?: boolean;
  max?: number;
}

export function fromMarkdown(src: string, names?: AtomNames, read?: ReadOptions): Loaded {
  const st: LoadState = { out: [], simplified: false, names };
  // exact: the spaces at the ends of lines are the writer's, and stay (see parse.ts, exactOn)
  blocksOf(parse(src, { exact: true, files: read?.files === true, ...(read?.max ? { max: read.max } : {}) }), null, st);
  // trailing and leading blank lines say nothing, and the parser drops them
  while (st.out.length > 1 && emptyLine(st.out[st.out.length - 1])) st.out.pop();
  return { blocks: st.out.length ? withoutSeparators(st.out) : [textBlock()], simplified: st.simplified };
}

/**
 * The blank line markdown needs between a quote and a callout, or between two
 * tables, which toMarkdown writes again by itself: it is not a line anyone wrote.
 */
function withoutSeparators(blocks: Block[]): Block[] {
  return blocks.filter((b, k) => {
    if (!emptyLine(b)) return true;
    const before = blocks[k - 1];
    const after = blocks[k + 1];
    if (!before || !after) return true;
    const angled = ANGLED.has(before.wrap) && ANGLED.has(after.wrap) && before.wrap !== after.wrap;
    const tables = before.kind === "table" && after.kind === "table" && !before.wrap && !after.wrap;
    return !(angled || tables);
  });
}

interface LoadState {
  out: Block[];
  simplified: boolean;
  names?: AtomNames;
}

/** One line of markdown as runs, block syntax left as it is: what pasting it into a line puts there. */
export function inlineFromMarkdown(line: string, names?: AtomNames): Inline[] {
  const out: Inline[] = [];
  inline(parse(line, { inline: true }).filter((n) => n.type !== "br"), {}, out, { out: [], simplified: false, names });
  return normalize(out);
}

function emptyLine(b: Block | undefined): boolean {
  return isText(b) && b.kind === "p" && !b.wrap && b.content.length === 0;
}

/** Keeps a new quote, callout or section apart from one of the same kind just before it. */
function apart(st: LoadState, wrap: Wrap): void {
  const last = st.out[st.out.length - 1];
  if (last && last.wrap === wrap) st.out.push(textBlock());
}

/** A paragraph's lines, split where its line breaks are. */
function lines(children: Node[], st: LoadState): Inline[][] {
  const out: Inline[][] = [[]];
  for (const n of children) {
    if (n.type === "br") out.push([]);
    else inline([n], {}, out[out.length - 1]!, st);
  }
  return out.map(normalize);
}

function blocksOf(nodes: Node[], wrap: Wrap, st: LoadState): void {
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        for (const line of lines(node.children, st)) st.out.push(textBlock("p", line, wrap));
        break;
      case "heading":
        st.out.push(textBlock(`h${node.level}` as TextBlock["kind"], lines(node.children, st).flat(), wrap));
        break;
      case "subtext":
        st.out.push(textBlock("subtext", lines(node.children, st).flat(), wrap));
        break;
      case "quote":
        if (wrap) st.simplified = true;
        else apart(st, "quote");
        for (const line of lines(node.children, st)) st.out.push(textBlock("p", line, wrap ?? "quote"));
        break;
      case "alert":
        if (wrap) {
          st.simplified = true;
          blocksOf(node.children, wrap, st);
          break;
        }
        apart(st, node.kind);
        if (node.children.length === 0) st.out.push(textBlock("p", [], node.kind));
        else blocksOf(node.children, node.kind, st);
        break;
      case "details":
        if (wrap) {
          st.simplified = true;
          st.out.push(textBlock("p", lines(node.summary, st).flat(), wrap));
          blocksOf(node.children, wrap, st);
          break;
        }
        apart(st, "details");
        st.out.push(textBlock("p", lines(node.summary, st).flat(), "details"));
        blocksOf(node.children, "details", st);
        break;
      case "list":
        listOf(node, wrap, 0, st);
        break;
      case "codeblock":
        st.out.push({ id: newId(), kind: "code", lang: node.lang ?? "", text: node.text, wrap });
        break;
      case "hr":
        st.out.push({ id: newId(), kind: "hr", wrap });
        break;
      case "file":
        st.out.push({ id: newId(), kind: "file", file: node.id, name: node.name, wrap, ...(node.width ? { width: node.width } : {}), ...(node.align ? { align: node.align } : {}) });
        break;
      case "table":
        st.out.push({
          id: newId(),
          kind: "table",
          wrap,
          align: node.align.slice(),
          rows: [node.head, ...node.rows].map((row) => row.map((cell) => lines(cell, st).flat())),
        });
        break;
      case "footnotes":
        for (const note of node.notes) st.out.push(textBlock("note", lines(note.children, st).flat(), wrap, { label: note.label }));
        break;
      default: {
        // inline nodes at the top level (never from a full parse): one line
        const line: Inline[] = [];
        inline([node], {}, line, st);
        st.out.push(textBlock("p", normalize(line), wrap));
      }
    }
  }
}

function listOf(list: Extract<Node, { type: "list" }>, wrap: Wrap, indent: number, st: LoadState): void {
  list.items.forEach((item, n) => {
    const box = item[0]?.type === "task" ? item[0] : null;
    const words: Node[] = [];
    const inner: Extract<Node, { type: "list" }>[] = [];
    for (const child of box ? item.slice(1) : item) {
      if (child.type === "list") inner.push(child);
      else words.push(child);
    }
    const content: Inline[] = [];
    inline(words, {}, content, st);
    st.out.push(
      textBlock("li", normalize(content), wrap, {
        list: { ordered: list.ordered, task: !!box, checked: !!box?.checked, indent: Math.min(indent, MAX_INDENT), start: n === 0 && list.ordered ? list.start : null },
      }),
    );
    for (const sub of inner) listOf(sub, wrap, indent + 1, st);
  });
}

function inline(nodes: Node[], marks: Marks, out: Inline[], st: LoadState): void {
  const names = st.names;
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({ kind: "text", text: n.text, marks });
        break;
      case "strong":
        inline(n.children, { ...marks, b: true }, out, st);
        break;
      case "em":
        inline(n.children, { ...marks, i: true }, out, st);
        break;
      case "u":
        inline(n.children, { ...marks, u: true }, out, st);
        break;
      case "s":
        inline(n.children, { ...marks, s: true }, out, st);
        break;
      case "spoiler":
        inline(n.children, { ...marks, spoiler: true }, out, st);
        break;
      case "mark":
        inline(n.children, { ...marks, mark: true }, out, st);
        break;
      case "sup":
        inline(n.children, { ...marks, sup: true }, out, st);
        break;
      case "sub":
        inline(n.children, { ...marks, sub: true }, out, st);
        break;
      case "color": {
        let m = marks;
        if (n.fg) m = withColor(m, "fg", n.fg);
        if (n.bg) m = withColor(m, "bg", n.bg);
        inline(n.children, m, out, st);
        break;
      }
      case "code":
        out.push({ kind: "text", text: n.text, marks: { ...marks, code: true } });
        break;
      case "link":
        if (n.masked) inline(n.children, { ...marks, link: { url: n.url, noEmbed: n.noEmbed } }, out, st);
        else if (n.noEmbed) out.push({ kind: "atom", atom: "link", raw: `<${n.url}>`, label: n.url, marks });
        // a bare address is text that happens to be a link, and stays one when written back
        else out.push({ kind: "text", text: n.url, marks });
        break;
      case "mention":
        if (n.kind === "everyone" || n.kind === "here") out.push({ kind: "text", text: "@" + n.kind, marks });
        else if (n.kind === "user") {
          const u = names?.users[n.id];
          out.push({ kind: "atom", atom: "user", raw: `<@${n.id}>`, label: "@" + (u ? u.display_name || u.username : t("render.unknownUser")), marks });
        } else if (n.kind === "channel") {
          out.push({ kind: "atom", atom: "channel", raw: `<#${n.id}>`, label: "#" + (names?.channels[n.id]?.name || t("render.unknownChannel")), marks });
        } else if (n.kind === "role") {
          out.push({ kind: "atom", atom: "role", raw: `<@&${n.id}>`, label: "@" + (names?.roles?.[n.id]?.name || t("render.unknownRole")), marks });
        }
        break;
      case "emoji":
        out.push({ kind: "atom", atom: "emoji", raw: `<${n.animated ? "a" : ""}:${n.name}:${n.id}>`, label: `:${n.name}:`, img: names?.emojiUrl(n.id, n.animated, 22), marks });
        break;
      case "unicodeEmoji":
        out.push({ kind: "text", text: n.text, marks });
        break;
      case "timestamp": {
        const d = new Date(n.unix * 1000);
        out.push({ kind: "atom", atom: "time", raw: `<t:${n.unix}:${n.style}>`, label: Number.isNaN(d.getTime()) ? String(n.unix) : formatStamp(d, n.style), marks });
        break;
      }
      case "footnoteRef":
        out.push({ kind: "atom", atom: "fnref", raw: `[^${n.label}]`, label: String(n.n), marks });
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// the editor's blocks -> markdown
// ---------------------------------------------------------------------------

/** Callouts and plain quotes are written with `>`, so two of them in a row would read as one. */
const ANGLED = new Set<Wrap>(["quote", "note", "tip", "important", "warning", "caution"]);

/**
 * The editor's blocks as markdown. With `lines`, each block that writes a
 * line of its own is given the index of that line (a code block, its opening
 * fence), so a place in a block can be found in the markdown and back again.
 */
export function toMarkdown(blocks: Block[], lines?: Map<Block, number>): string {
  let start = 0;
  let end = blocks.length;
  // the parser drops blank lines at either end, so they are not written
  while (start < end && emptyLine(blocks[start])) start += 1;
  while (end > start && emptyLine(blocks[end - 1])) end -= 1;
  const out: string[] = [];
  let prevWrap: Wrap | undefined;
  let prevTable = false;
  let i = start;
  while (i < end) {
    const wrap = blocks[i]!.wrap;
    let j = i;
    while (j < end && blocks[j]!.wrap === wrap) j += 1;
    const run = blocks.slice(i, j);
    if (wrap && ANGLED.has(wrap) && prevWrap && ANGLED.has(prevWrap)) out.push("");
    if (prevTable && run[0]?.kind === "table") out.push("");
    const base = out.length;
    const at = lines ? new Map<Block, number>() : undefined;
    if (wrap === "quote") {
      out.push(...quoteLines(run));
      run.forEach((b, k) => at?.set(b, k));
    } else if (wrap === "details") out.push(...detailsLines(run, at));
    else if (wrap) {
      out.push(`> [!${wrap.toUpperCase()}]`, ...withoutTrailingBlanks(flowLines(run, false, at)).map((l) => (l === "" ? ">" : "> " + l)));
      // under the callout's own line
      if (at) for (const [b, k] of at) at.set(b, k + 1);
    } else out.push(...flowLines(run, prevTable, at));
    if (lines && at) for (const [b, k] of at) if (base + k < out.length) lines.set(b, base + k);
    prevWrap = wrap;
    prevTable = !wrap && run[run.length - 1]?.kind === "table";
    i = j;
  }
  return out.join("\n");
}

function quoteLines(run: Block[]): string[] {
  return run.map((block, n) => {
    const content = isText(block) ? inlineMarkdown(block.content) : block.kind === "code" ? block.text.replace(/\n/g, " ") : "";
    // a first line reading [!NOTE] would make the quote a callout
    const line = n === 0 && RE_ALERT.test(content) ? "\\" + content : content;
    return line === "" ? ">" : "> " + line;
  });
}

function detailsLines(run: Block[], at?: Map<Block, number>): string[] {
  const head = run[0];
  const summary = isText(head) ? inlineMarkdown(head.content) : "";
  const body = isText(head) ? run.slice(1) : run;
  const inner = at ? new Map<Block, number>() : undefined;
  const lines = [summary ? `::: details ${summary}` : "::: details", ...withoutTrailingBlanks(flowLines(body, false, inner)), ":::"];
  if (at) {
    if (isText(head)) at.set(head, 0);
    for (const [b, k] of inner ?? []) at.set(b, k + 1);
  }
  return lines;
}

/** A callout or section ends at its last line with words; the parser drops the blank ones after it anyway. */
function withoutTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end -= 1;
  return lines.slice(0, end);
}

/** Blocks with no wrap of their own, or the inside of a callout or section. */
function flowLines(run: Block[], afterTable = false, at?: Map<Block, number>): string[] {
  const out: string[] = [];
  // per list level: the column items start at, their marker's width, the next number
  const levels: { col: number; width: number; next: number; ordered: boolean }[] = [];
  let prevTable = afterTable;
  for (const block of run) {
    if (!(isText(block) && block.kind === "li")) levels.length = 0;
    // a table after a table gets a blank line first; every other block starts where the lines stand
    at?.set(block, out.length + (prevTable && block.kind === "table" ? 1 : 0));
    switch (block.kind) {
      case "code": {
        let fence = "```";
        const longest = Math.max(0, ...(block.text.match(/`+/g) ?? []).map((m) => m.length));
        if (longest >= 3) fence = "`".repeat(longest + 1);
        const lang = block.lang.replace(/[^a-zA-Z0-9_+-]/g, "");
        out.push(fence + lang, ...block.text.split("\n"), fence);
        break;
      }
      case "hr":
        out.push("---");
        break;
      case "file":
        out.push(fileLine(block.file, block.name, block.width, block.align));
        break;
      case "table": {
        if (prevTable) out.push("");
        const row = (cells: Inline[][]) => "| " + cells.map((c) => inlineMarkdown(c, { cell: true }) || " ").join(" | ") + " |";
        const [head, ...rows] = block.rows;
        out.push(row(head ?? []));
        out.push("|" + block.align.map((a) => (a === "center" ? ":-:" : a === "left" ? ":--" : a === "right" ? "--:" : "---")).join("|") + "|");
        for (const r of rows) out.push(row(r));
        break;
      }
      default: {
        const tb = block as TextBlock;
        out.push(textLine(tb, levels, prevTable));
      }
    }
    prevTable = block.kind === "table";
  }
  return out;
}

function textLine(block: TextBlock, levels: { col: number; width: number; next: number; ordered: boolean }[], afterTable: boolean): string {
  const content = inlineMarkdown(block.content);
  switch (block.kind) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      // trailing hashes would be read as the heading's closing ones
      const safe = /(^|[ \t])#+[ \t]*$/.test(content) ? content.replace(/#+([ \t]*)$/, (m) => "\\" + m) : content;
      return "#".repeat(Number(block.kind.slice(1))) + " " + safe;
    }
    case "subtext":
      return "-# " + content;
    case "note":
      return `[^${block.label ?? "note"}]: ` + content;
    case "li": {
      const list = block.list ?? { ordered: false, task: false, checked: false, indent: 0, start: null };
      const depth = Math.min(list.indent, levels.length);
      levels.length = depth + 1;
      const parent = levels[depth - 1];
      const col = parent ? parent.col + parent.width : 0;
      const cur = levels[depth];
      let n = 1;
      if (list.ordered) {
        n = list.start ?? (cur && cur.ordered ? cur.next : 1);
      }
      const marker = list.ordered ? `${n}.` : "-";
      levels[depth] = { col, width: marker.length + 1, next: n + 1, ordered: list.ordered };
      const box = list.task ? (list.checked ? "[x] " : "[ ] ") : "";
      // words starting [ ] or [x] would tick a box that is not there
      const words = !list.task && /^\[[ xX]\]([ \t]|$)/.test(content) ? "\\" + content : content;
      const line = " ".repeat(col) + marker + " " + box + words;
      return RE_HR.test(line) ? " ".repeat(col) + marker + " " + box + "\\" + words : line;
    }
    default:
      return paragraphLine(content, afterTable);
  }
}

/**
 * A plain line, with a backslash before whatever at its start would make it
 * a block: a heading, a list, a quote, a rule, a section, a footnote. Right
 * after a table, and wherever it could be a table's dash row, its pipes are
 * escaped so it stays text.
 */
function paragraphLine(content: string, afterTable: boolean): string {
  let s = content;
  const lead = /^[ \t]*/.exec(s)?.[0] ?? "";
  const rest = s.slice(lead.length);
  if (RE_HEADING.test(rest) || /^#{1,6}$/.test(rest)) s = lead + "\\" + rest;
  else if (rest.startsWith(">")) s = lead + "\\" + rest;
  else if (rest.startsWith("-# ")) s = lead + "\\" + rest;
  else if (RE_HR.test(s)) s = lead + "\\" + rest;
  else if (rest.startsWith(":::")) s = lead + "\\" + rest;
  else if (RE_FOOTNOTE_DEF.test(rest)) s = lead + "\\" + rest;
  else {
    const item = RE_LIST.exec(s);
    if (item) {
      const markerAt = lead.length + (item[3] !== undefined ? item[3].length : 0);
      s = s.slice(0, markerAt) + "\\" + s.slice(markerAt);
    }
  }
  const dashes = /^[ \t|:-]+$/.test(s) && s.includes("|") && s.includes("-");
  if (afterTable || dashes) s = s.replace(/(^|[^\\])\|/g, "$1\\|").replace(/(^|[^\\])\|/g, "$1\\|");
  return s;
}

// ---------------------------------------------------------------------------
// inline
// ---------------------------------------------------------------------------

type Key = string;

/** From outermost to innermost; code is innermost of all, as nothing inside it can be marked. */
const ORDER = ["link", "color", "spoiler", "s", "u", "b", "i", "mark", "sup", "sub"];

/** Marks whose markers must touch words: spaces at their edges go outside them. */
const HUGGING = ["b", "i", "u", "mark"] as const;

interface Cell {
  /** One character, or an atom's markdown. */
  ch: string;
  atom: boolean;
  marks: Marks;
}

function keysOf(m: Marks): Key[] {
  const out: Key[] = [];
  if (m.link) out.push(`link\u0000${m.link.url}\u0000${m.link.noEmbed ? 1 : 0}`);
  if (m.color) out.push(`color\u0000${m.color.fg ?? ""}\u0000${m.color.bg ?? ""}`);
  for (const f of ["spoiler", "s", "u", "b", "i", "mark", "sup", "sub"] as const) if (m[f]) out.push(f);
  return out;
}

function rank(key: Key): number {
  return ORDER.indexOf(key.split("\u0000")[0]!);
}

function cellsOf(content: Inline[]): Cell[] {
  const out: Cell[] = [];
  for (const r of content) {
    if (r.kind === "atom") out.push({ ch: r.raw, atom: true, marks: r.marks });
    else for (const ch of r.text.replace(/\n/g, " ")) out.push({ ch, atom: false, marks: r.marks });
  }
  return out;
}

/** Moves spaces at the edges of bold, italics, underline and highlight outside them. */
function hug(cells: Cell[]): Cell[] {
  const out = cells.map((c) => ({ ...c }));
  for (const f of HUGGING) {
    let k = 0;
    while (k < out.length) {
      if (!out[k]!.marks[f]) {
        k += 1;
        continue;
      }
      let e = k;
      while (e < out.length && out[e]!.marks[f] && !out[e]!.marks.code) e += 1;
      if (e === k) {
        k += 1;
        continue;
      }
      let s = k;
      while (s < e && !out[s]!.atom && /\s/.test(out[s]!.ch)) {
        out[s]!.marks = { ...out[s]!.marks, [f]: undefined };
        delete out[s]!.marks[f];
        s += 1;
      }
      let z = e;
      while (z > s && !out[z - 1]!.atom && /\s/.test(out[z - 1]!.ch)) {
        out[z - 1]!.marks = { ...out[z - 1]!.marks };
        delete out[z - 1]!.marks[f];
        z -= 1;
      }
      k = e;
    }
  }
  return out;
}

/**
 * Underline and highlight only begin and end at the edge of a word (so that
 * `snake__case` and `a==b==c` stay text), so markdown has no way to say them
 * for part of a word. Such a span is written without that mark rather than
 * with markers the reader would see: the line is laid out, spans whose
 * marker would touch a letter lose the mark, and it is laid out again.
 */
function wordEdges(cells: Cell[]): Cell[] {
  let out = cells;
  for (let round = 0; round < 4; round++) {
    const stuck: Stuck[] = [];
    pieces(out, "*", stuck);
    if (stuck.length === 0) return out;
    out = out.map((c) => ({ ...c }));
    for (const s of stuck) {
      for (let j = s.from; j < s.to; j++) {
        const c = out[j]!;
        c.marks = { ...c.marks };
        delete c.marks[s.flag];
      }
    }
  }
  return out;
}

interface Piece {
  raw: boolean;
  s: string;
  /** For text: whether it sits inside a link or colour's brackets, or a superscript's braces. */
  inLabel?: boolean;
  inBraces?: boolean;
  /** An italic marker, and which pair it belongs to: its character is chosen once the line is known. */
  italic?: number;
}

function segmentsOf(cells: Cell[]): { marks: Marks; cells: Cell[] }[] {
  const out: { marks: Marks; cells: Cell[] }[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && sameMarks(last.marks, c.marks)) last.cells.push(c);
    else out.push({ marks: c.marks, cells: [c] });
  }
  return out;
}

function destination(link: NonNullable<Marks["link"]>): string {
  if (link.noEmbed) return "<" + link.url.replace(/[\s>]/g, (c) => encodeURIComponent(c)) + ">";
  // one level of balanced parentheses reads as part of the address; anything else is encoded
  const url = link.url.replace(/\s/g, (c) => encodeURIComponent(c));
  if (/^(?:[^()]|\([^()]*\))*$/.test(url)) return url;
  return url.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
}

function openOf(key: Key, italic: string): string {
  const [name] = key.split("\u0000");
  switch (name) {
    case "link":
    case "color":
      return "[";
    case "spoiler":
      return "||";
    case "s":
      return "~~";
    case "u":
      return "__";
    case "b":
      return "**";
    case "i":
      return italic;
    case "mark":
      return "==";
    case "sup":
      return "^{";
    default:
      return "_{";
  }
}

function closeOf(key: Key, italic: string): string {
  const [name, a, b] = key.split("\u0000");
  switch (name) {
    case "link":
      return "](" + destination({ url: a ?? "", noEmbed: b === "1" }) + ")";
    case "color":
      return "]{" + formatColorSpec({ fg: a || null, bg: b || null }) + "}";
    case "sup":
    case "sub":
      return "}";
    default:
      return openOf(key, italic);
  }
}

/** A code span: fenced with more backticks than it holds, padded when it starts or ends with one. */
function codeSpan(code: string): string {
  if (code === "") return "";
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return fence + pad + code + pad + fence;
}

/** An underline or highlight span whose marker would touch a word, by cell. */
interface Stuck {
  flag: "u" | "mark";
  from: number;
  to: number;
}

function pieces(cells: Cell[], italic: string, stuck?: Stuck[]): Piece[] {
  const segs = segmentsOf(cells);
  const out: Piece[] = [];
  const stack: Key[] = [];
  const pairs: number[] = [];
  let pair = 0;
  // where each underline and highlight opened: its piece and its first cell
  const edges = new Map<Key, { piece: number; cell: number }>();
  const spans: { flag: "u" | "mark"; open: number; close: number; from: number; to: number }[] = [];
  let cell = 0;
  const lasts = (k: number, key: Key): number => {
    let n = 0;
    while (k + n < segs.length && keysOf(segs[k + n]!.marks).includes(key)) n += 1;
    return n;
  };
  const close = (key: Key) => {
    out.push(key === "i" ? { raw: true, s: italic, italic: pairs.pop() } : { raw: true, s: closeOf(key, italic) });
    const edge = edges.get(key);
    if (edge && (key === "u" || key === "mark")) spans.push({ flag: key, open: edge.piece, close: out.length - 1, from: edge.cell, to: cell });
  };
  segs.forEach((seg, k) => {
    const want = keysOf(seg.marks);
    const cut = stack.findIndex((key) => !want.includes(key));
    if (cut >= 0) {
      for (let j = stack.length - 1; j >= cut; j--) close(stack[j]!);
      stack.length = cut;
    }
    const open = want.filter((key) => !stack.includes(key)).sort((a, b) => lasts(k, b) - lasts(k, a) || rank(a) - rank(b));
    for (const key of open) {
      if (key === "i") {
        pair += 1;
        pairs.push(pair);
        out.push({ raw: true, s: italic, italic: pair });
      } else out.push({ raw: true, s: openOf(key, italic) });
      edges.set(key, { piece: out.length - 1, cell });
      stack.push(key);
    }
    cell += seg.cells.length;
    const inLabel = stack.some((key) => key.startsWith("link") || key.startsWith("color"));
    const inBraces = stack.includes("sup") || stack.includes("sub");
    if (seg.marks.code) {
      out.push({ raw: true, s: codeSpan(seg.cells.map((c) => c.ch).join("")) });
      return;
    }
    let buf = "";
    for (const c of seg.cells) {
      if (c.atom) {
        if (buf) out.push({ raw: false, s: buf, inLabel, inBraces });
        buf = "";
        out.push({ raw: true, s: c.ch });
      } else buf += c.ch;
    }
    if (buf) out.push({ raw: false, s: buf, inLabel, inBraces });
  });
  for (let j = stack.length - 1; j >= 0; j--) close(stack[j]!);
  if (italic === "*") chooseItalics(out);
  if (stuck) {
    const before = (k: number) => {
      for (let j = k - 1; j >= 0; j--) if (out[j]!.s) return out[j]!.s.slice(-1);
      return "";
    };
    const after = (k: number) => {
      for (let j = k + 1; j < out.length; j++) if (out[j]!.s) return out[j]!.s.charAt(0);
      return "";
    };
    for (const s of spans) if (RE_WORD.test(before(s.open)) || RE_WORD.test(after(s.close))) stuck.push({ flag: s.flag, from: s.from, to: s.to });
  }
  return out;
}

/**
 * Italics are written with `*` unless a star right beside the marker would
 * run into it (after bold, before bold, where overlapping marks close and
 * open again), in which case `_` is used where the words around allow it.
 */
function chooseItalics(parts: Piece[]): void {
  const pairs = new Map<number, [number, number]>();
  parts.forEach((p, k) => {
    if (p.italic === undefined) return;
    const cur = pairs.get(p.italic);
    pairs.set(p.italic, cur ? [cur[0], k] : [k, k]);
  });
  // A marker only runs into its neighbour's marker characters: a star or
  // underscore in the words beside it gets a backslash of its own.
  const markerBefore = (k: number): string => {
    for (let j = k - 1; j >= 0; j--) if (parts[j]!.s) return parts[j]!.raw ? parts[j]!.s.slice(-1) : "";
    return "";
  };
  const markerAfter = (k: number): string => {
    for (let j = k + 1; j < parts.length; j++) if (parts[j]!.s) return parts[j]!.raw ? parts[j]!.s.charAt(0) : "";
    return "";
  };
  const charBefore = (k: number): string => {
    for (let j = k - 1; j >= 0; j--) if (parts[j]!.s) return parts[j]!.s.slice(-1);
    return "";
  };
  const charAfter = (k: number): string => {
    for (let j = k + 1; j < parts.length; j++) if (parts[j]!.s) return parts[j]!.s.charAt(0);
    return "";
  };
  for (const [open, close] of pairs.values()) {
    const touching = [markerBefore(open), markerAfter(open), markerBefore(close), markerAfter(close)];
    if (!touching.includes("*")) continue;
    // an underscore cannot sit inside a word, nor against another underscore
    if (touching.includes("_") || RE_WORD.test(charBefore(open)) || RE_WORD.test(charAfter(close))) continue;
    parts[open]!.s = "_";
    parts[close]!.s = "_";
  }
}

const RE_PUNCT = /[!-/:-@[-`{-~]/;
const RE_WORD = /[\p{L}\p{N}_]/u;

/**
 * Escapes the text pieces, knowing what surrounds each character in the
 * final line: only what could be read as markup gets a backslash, unless
 * `full` asks for every punctuation mark to get one. Web addresses are left
 * whole, so they still link.
 */
function assemble(parts: Piece[], opts: { cell?: boolean; full?: boolean }): string {
  // the line as it will be, to look ahead and behind across pieces
  const plain = parts.map((p) => p.s).join("");
  let at = 0;
  let out = "";
  for (const p of parts) {
    if (p.raw) {
      out += p.s;
      at += p.s.length;
      continue;
    }
    const s = p.s;
    const urls: [number, number][] = [];
    for (const m of s.matchAll(/https?:\/\/[^\s<]+/gi)) {
      const url = trimUrl(m[0]);
      if (url.length > 8) urls.push([m.index ?? 0, (m.index ?? 0) + url.length]);
    }
    for (let k = 0; k < s.length; k++) {
      const url = urls.find(([a, b]) => k >= a && k < b);
      if (url) {
        out += s.slice(k, url[1]);
        at += url[1] - k;
        k = url[1] - 1;
        continue;
      }
      const c = s.charAt(k);
      const prev = plain.charAt(at - 1);
      const next = plain.charAt(at + 1);
      const ahead = plain.slice(at);
      let esc = false;
      if (RE_PUNCT.test(c)) {
        if (opts.full) esc = true;
        else {
          switch (c) {
            case "\\":
              esc = next !== "" && RE_PUNCT.test(next);
              break;
            case "*":
            case "`":
              esc = true;
              break;
            case "_":
              esc = !(RE_WORD.test(prev) && RE_WORD.test(next)) || next === "{";
              break;
            case "~":
              esc = prev === "~" || next === "~";
              break;
            case "|":
              esc = !!opts.cell || prev === "|" || next === "|";
              break;
            case "=":
              esc = prev === "=" || next === "=";
              break;
            case "^":
              esc = next === "{";
              break;
            case "[":
              esc = next === "^" || /\](\(|\{)/.test(ahead);
              break;
            case "]":
              esc = !!p.inLabel;
              break;
            case "{":
            case "}":
              esc = !!p.inBraces;
              break;
            case "<":
              esc = /^<(@|#|:|a:|t:|https?:\/\/)/i.test(ahead);
              break;
            case ":": {
              const code = /^:([a-z0-9_+-]{1,60}):/.exec(ahead);
              esc = !!code && !!shortcodeToEmoji(code[1]!);
              break;
            }
            default:
              esc = false;
          }
        }
      }
      out += esc ? "\\" + c : c;
      at += 1;
    }
  }
  return out;
}

/** The runs the parser reads back from a line, for checking a line says what it should. */
function readBack(line: string): Inline[] {
  const out: Inline[] = [];
  const nodes = parse(line, { inline: true });
  inline(nodes, {}, out, { out: [], simplified: false });
  return normalize(out);
}

function sameRuns(a: Inline[], b: Inline[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, k) => {
    const o = b[k]!;
    if (r.kind !== o.kind || !sameMarks(r.marks, o.marks)) return false;
    return r.kind === "text" ? r.text === (o as typeof r).text : r.raw === (o as typeof r).raw;
  });
}

function runsOf(cells: Cell[]): Inline[] {
  const out: Inline[] = [];
  for (const c of cells) {
    if (c.atom) out.push({ kind: "atom", atom: "fnref", raw: c.ch, label: c.ch, marks: c.marks });
    else out.push({ kind: "text", text: c.ch, marks: c.marks });
  }
  return normalize(out);
}

/**
 * A line's worth of runs as markdown. The markers are chosen to nest (the
 * longest-lasting outermost), text is escaped only where it would otherwise
 * be read as markup, and the result is read back with the real parser: when
 * it would not say what the runs say (italics against bold, a stray marker
 * no rule foresaw) the next way of writing it is tried, down to escaping
 * every punctuation mark.
 */
export function inlineMarkdown(content: Inline[], opts: { cell?: boolean } = {}): string {
  const cells = wordEdges(hug(cellsOf(content)));
  const want = runsOf(cells).map((r) => (r.kind === "atom" ? r : r));
  const tries: { italic: string; full: boolean }[] = [
    { italic: "*", full: false },
    { italic: "_", full: false },
    { italic: "*", full: true },
    { italic: "_", full: true },
  ];
  let first = "";
  for (const attempt of tries) {
    const line = assemble(pieces(cells, attempt.italic), { cell: opts.cell, full: attempt.full });
    if (!first) first = line;
    if (sameRuns(comparable(readBack(line)), comparable(want))) return line;
  }
  // Nothing reads back exactly: most often a label naming another site than
  // its link goes to, which the reader is shown on purpose. The first way of
  // writing it is the plainest.
  return first;
}

/** Atoms compare by their markdown, whatever label each side gave them. */
function comparable(runs: Inline[]): Inline[] {
  return runs.map((r) => (r.kind === "atom" ? { ...r, atom: "fnref" as const, label: r.raw, img: undefined } : r));
}

/** Whether a link's words name some other site than the one it goes to (the reader will see both). */
export function misleads(content: Inline[]): boolean {
  const byUrl = new Map<string, string>();
  for (const r of content) if (r.marks.link) byUrl.set(r.marks.link.url, (byUrl.get(r.marks.link.url) ?? "") + (r.kind === "text" ? r.text : r.label));
  for (const [url, label] of byUrl) if (misleadingLabel(label, url)) return true;
  return false;
}

/** How a table column lines up, as the toolbar offers it. */
export type { Align, AlertKind };
