import { shortcodeToEmoji } from "@/lib/shortcodes";
import type { AlertKind, Align, Node, RenderCtx } from "./ast";
import { parseColorSpec } from "./colors";

import { t } from "@/i18n";
// ---------------------------------------------------------------------------
// Nexa's markdown parser: the chat syntax people know (Discord's), with
// GitHub's blocks on top of it.
//
// The parser is a single left-to-right scan. Block constructs are recognised at
// line starts only; inline constructs are parsed one line at a time, which is
// what makes `**a\nb**` stay literal. Recursion is capped and every search for
// a closing marker is bounded or remembered, so that adversarial input can
// neither blow the stack nor go quadratic.
// ---------------------------------------------------------------------------

/** Nesting cap for inline constructs; keeps the parser linear on marker soup. */
const MAX_DEPTH = 24;
/** How deep callouts and collapsible sections may hold one another. */
const MAX_BLOCK_DEPTH = 4;
/** Lists nest this deep; a deeper item joins the deepest list. */
const MAX_LIST_DEPTH = 6;
/** Columns in a table; a wider one stays text, and a row's extra cells are dropped. */
const MAX_TABLE_COLS = 24;
/** How far a `^{…}` or `_{…}` looks for its closing brace. */
const MAX_BRACE = 256;
/** How far a `[label]` looks for its closing bracket. */
const MAX_LABEL = 512;
/** At most this many embeds per message. */
const MAX_URLS = 5;
/** Above this many emoji a message is no longer rendered jumbo. */
const MAX_JUMBO_EMOJI = 30;
/**
 * Only this much of a message is parsed. The composer sends at most 4000
 * characters, but a hand-built message can be far longer, and every reader
 * parses it several times per render.
 */
const MAX_SOURCE = 8000;

const RE_USER = /<@!?(\d{1,32})>/y;
const RE_CHANNEL = /<#(\d{1,32})>/y;
const RE_ROLE = /<@&(\d{1,32})>/y;
const RE_CUSTOM_EMOJI = /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,32})>/y;
const RE_SHORTCODE = /:([a-z0-9_+-]{1,60}):/y;
const RE_TIMESTAMP = /<t:(-?\d{1,19})(?::([tTdDfFR]))?>/y;
const RE_ANGLE_URL = /<(https?:\/\/[^\s>]+)>/iy;
const RE_URL = /https?:\/\/[^\s<]+/iy;
// bounded, so a line of unclosed brackets is not rescanned to its end from each one
const RE_MASKED = /\[([^\]\n]{0,512})\]\(\s*(<[^>\s]{1,2048}>|[^()\s]{1,2048})\s*\)/y;
/**
 * A link's destination right after a bracketed label that may itself hold
 * brackets; one level of balanced parentheses may be part of the address, as
 * in a Wikipedia link.
 */
const RE_DEST = /\(\s*(<[^>\s]{1,2048}>|(?:[^()\s]|\([^()\s]{0,2048}\)){1,2048})\s*\)/y;
/** The braces after `[words]`: a colour, checked by parseColorSpec. */
const RE_COLOR_BRACES = /\{([a-zA-Z0-9# ]{1,40})\}/y;
const RE_FOOTNOTE_REF = /\[\^([^\]\s]{1,64})\]/y;
const RE_FENCE_LANG = /[a-zA-Z0-9_+-]*/y;
export const RE_HEADING = /^(#{1,6})[ \t](.*)$/;
/** A heading's optional closing hashes: `## Title ##`. */
const RE_HEADING_CLOSE = /(?:^|[ \t]+)#+[ \t]*$/;
export const RE_SUBTEXT = /^-# (.*)$/;
export const RE_HR = /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// A bullet is "-" or "*". A "+" at the start of a line is someone saying "plus",
// and was turned into a dot.
export const RE_LIST = /^([ \t]*)(?:([-*])|(\d{1,9})([.)]))[ \t]+(.*)$/;
const RE_TASK = /^\[([ xX])\](?:[ \t]+(.*))?$/;
export const RE_ALERT = /^\[!(note|tip|important|warning|caution)\](?:[ \t]+(.*))?$/i;
export const RE_DETAILS_OPEN = /^:::[ \t]*details(?:[ \t]+(.*))?$/i;
const RE_DETAILS_CLOSE = /^:::[ \t]*$/;
export const RE_FOOTNOTE_DEF = /^\[\^([^\]\s]{1,64})\]:[ \t]*/;
const RE_DELIM_CELL = /^:?-+:?$/;
const RE_PUNCT = /[!-/:-@[-`{-~]/;
const RE_WORD = /[\p{L}\p{N}_]/u;
const RE_HTTP = /^https?:\/\/\S/i;
/** An address written into a link's label: a host name, with or without its scheme. */
const RE_LABEL_HOST = /(?:^|[\s(<[])(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?=[/:\s)>\]?#]|$)/iu;

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Whether a masked link's label names a different site from the one it goes
 * to — "[bank.example](https://elsewhere.example)". Shown masked, the label
 * is all anyone sees on a phone, where no tooltip gives the address away.
 */
export function misleadingLabel(label: string, url: string): boolean {
  const m = RE_LABEL_HOST.exec(label.trim());
  if (!m) return false;
  let real: string;
  try {
    real = bareHost(new URL(url).hostname);
  } catch {
    return true;
  }
  const shown = bareHost(m[1] ?? "");
  return shown !== real && !real.endsWith("." + shown);
}
/**
 * An emoji in running text. A symbol that is text by default — ©, ®, ™, ↔,
 * ▶ — is only an emoji when it asks to be one, with U+FE0F or a skin tone,
 * or when a joiner makes it part of a sequence (🏳‍🌈 with its U+FE0F left
 * out), so "Nexa™" keeps its trademark sign rather than growing a picture
 * mid-word. Characters drawn as emoji by default need nothing.
 */
const RE_UNICODE_EMOJI =
  /(?:\p{RI}\p{RI}|[0-9#*]\u{FE0F}?\u{20E3}|(?:(?=\p{Extended_Pictographic})\p{Emoji_Presentation}(?:\u{FE0F}|\p{Emoji_Modifier})?|\p{Extended_Pictographic}(?:\u{FE0F}\p{Emoji_Modifier}?|\p{Emoji_Modifier}|(?=\u{200D}\p{Extended_Pictographic})))(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})?)*)/uy;

const BLOCK_TYPES = new Set(["paragraph", "quote", "heading", "subtext", "list", "codeblock", "hr", "table", "alert", "details", "footnotes", "file"]);

/**
 * A note's file, alone on its line: `![name](nexa-file:id)`, or with how wide
 * a picture is drawn, in percent of the line, `![name](nexa-file:id?w=60)`.
 * The name has no brackets or line breaks in it.
 */
export const RE_FILE = /^!\[([^\[\]\n]{0,200})\]\(nexa-file:([A-Za-z0-9_-]{1,64})(?:\?w=(\d{1,3}))?\)[ \t]*$/;

/** The narrowest a picture in a note may be drawn, in percent of the line. */
export const FILE_MIN_WIDTH = 15;

/** A picture's width as a note may hold it: a whole percentage, the full line left unsaid. */
export function fileWidth(w: number | undefined | null): number | undefined {
  if (w === undefined || w === null || !Number.isFinite(w)) return undefined;
  const n = Math.round(w);
  return n >= 100 ? undefined : Math.max(FILE_MIN_WIDTH, n);
}

/** The line that puts a file in a note's text. */
export function fileLine(id: string, name: string, width?: number): string {
  const w = fileWidth(width);
  return `![${name.replace(/[\[\]\s]+/g, " ").trim().slice(0, 200)}](nexa-file:${id}${w ? `?w=${w}` : ""})`;
}

/** Whether file lines are being read as files: on for the length of one parse of a note. */
let filesOn = false;
/**
 * Whether spaces at the ends of lines are kept everywhere, for the editor:
 * on for the length of one parse that reads text back into it. A space just
 * typed at the end of a list item, a heading or a table cell is about to have
 * a word after it, and in a note written together, the editor reads the text
 * back each time someone else types. Dropping the space there dropped it for
 * everyone ("board games" arrived as "boardgames"). Shown messages trim them,
 * as they always have.
 */
let exactOn = false;
/** Trims what the editor gives back exactly: only the spaces at the start. */
const trimRead = (s: string): string => (exactOn ? s.replace(/^[ \t]+/, "") : s.trim());

const at = (s: string, i: number): string => (i >= 0 && i < s.length ? s.charAt(i) : "");
const isWordChar = (c: string): boolean => c !== "" && RE_WORD.test(c);
const isNonSpace = (c: string): boolean => c !== "" && !/\s/.test(c);

function runOf(s: string, i: number, ch: string): number {
  let n = 0;
  while (i + n < s.length && s.charAt(i + n) === ch) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Parse a message into an AST. With `inline: true` every block construct
 * (headings, lists, quotes, fenced code, tables, callouts) is disabled, which
 * is what message previews want; newlines still become `br` nodes.
 */
export function parse(src: string, opts?: { inline?: boolean; files?: boolean; max?: number; exact?: boolean }): Node[] {
  // a note is as long as a note is; a message is held to a message's length
  const max = Math.max(MAX_SOURCE, opts?.max ?? 0);
  const text = normalize(src.length > max ? src.slice(0, max) : src);
  if (text === "") return [];
  const notes: Notes = new Map();
  const was = filesOn;
  const wasExact = exactOn;
  filesOn = opts?.files === true;
  exactOn = opts?.exact === true;
  try {
    const nodes = opts?.inline ? parseInline(text, 0) : parseBlocks(text, 0, notes);
    return text.includes("[^") ? resolveFootnotes(nodes, notes) : nodes;
  } finally {
    filesOn = was;
    exactOn = wasExact;
  }
}

function normalize(src: string): string {
  const s = src.replace(/\r\n?/g, "\n");
  // Blank lines at the end say nothing and go. Spaces at the end of the last
  // line with words on it stay: in a note being written together, that is
  // the space someone just typed before their next word, and taking it away
  // took it away from everyone. Walked back by hand, because /\s+$/ retries
  // from every space of a long run that is not at the end.
  let end = s.length;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c === 10) end = i;
    else if (c !== 32 && c !== 9) break;
  }
  return s.slice(0, end).replace(/^\n+/, "");
}

// ---------------------------------------------------------------------------
// block level
// ---------------------------------------------------------------------------

/** A footnote's definition, kept where it was written until we know whether anything points at it. */
interface Note {
  /** The paragraph showing it as typed, its contents, and the list that holds it. */
  node: Node;
  shown: Node[];
  parent: Node[];
  children: Node[];
}
type Notes = Map<string, Note>;

interface ListFrame {
  ordered: boolean;
  start: number;
  items: Node[][];
  /** The column its items' markers start at. */
  indent: number;
}

function listNode(frame: ListFrame): Node {
  return { type: "list", ordered: frame.ordered, start: frame.start, items: frame.items };
}

/** Closes the innermost open list into its parent's last item. */
function closeFrame(stack: ListFrame[]): void {
  const done = stack.pop();
  const parent = stack[stack.length - 1];
  if (!done || !parent) return;
  const last = parent.items[parent.items.length - 1];
  if (last) last.push(listNode(done));
  else parent.items.push([listNode(done)]);
}

/** How many columns of indentation a line starts with; a tab reaches the next multiple of four. */
function columns(indent: string): number {
  let col = 0;
  for (const c of indent) col = c === "\t" ? col + 4 - (col % 4) : col + 1;
  return col;
}

/** A list item's words: a task box first, when it starts with `[ ]` or `[x]`. */
function itemContent(raw: string): Node[] {
  const task = RE_TASK.exec(raw);
  if (!task) return parseInline(raw, 0);
  return [{ type: "task", checked: task[1] !== " " }, ...parseInline(trimRead(task[2] ?? ""), 0)];
}

function parseBlocks(src: string, depth: number, notes: Notes): Node[] {
  const out: Node[] = [];
  let paraLines: string[] = [];
  let quoteLines: string[] | null = null;
  let alert: { kind: AlertKind; lines: string[] } | null = null;
  let lists: ListFrame[] | null = null;
  const nested = depth < MAX_BLOCK_DEPTH;

  const flushPara = (): void => {
    if (paraLines.length === 0) return;
    out.push({ type: "paragraph", children: parseInline(paraLines.join("\n"), 0) });
    paraLines = [];
  };
  const flushQuote = (): void => {
    if (alert) {
      out.push({ type: "alert", kind: alert.kind, children: parseBlocks(trimBlankLines(alert.lines.join("\n")), depth + 1, notes) });
      alert = null;
    }
    if (!quoteLines) return;
    out.push({ type: "quote", children: parseInline(quoteLines.join("\n"), 0) });
    quoteLines = null;
  };
  const flushList = (): void => {
    if (!lists) return;
    while (lists.length > 1) closeFrame(lists);
    const root = lists[0];
    if (root) out.push(listNode(root));
    lists = null;
  };
  const flushAll = (): void => {
    flushPara();
    flushQuote();
    flushList();
  };

  let i = 0;
  let atLineStart = true;
  while (i < src.length) {
    const eol = src.indexOf("\n", i);
    const lineEnd = eol < 0 ? src.length : eol;
    const line = src.slice(i, lineEnd);

    if (atLineStart) {
      // fenced code block -------------------------------------------------
      if (line.startsWith("```")) {
        flushAll();
        const next = readFence(src, i, out);
        if (next >= src.length) {
          i = src.length;
        } else if (src.charAt(next) === "\n") {
          i = next + 1;
        } else {
          i = next;
          atLineStart = false;
        }
        continue;
      }
      // >>> block quote: swallows the rest of the message -------------------
      if (line === ">>>" || line.startsWith(">>> ")) {
        flushAll();
        const body = src.slice(i + (line === ">>>" ? 3 : 4));
        const callout = nested && line !== ">>>" ? RE_ALERT.exec(line.slice(4)) : null;
        if (callout) {
          // `>>> [!NOTE]` makes the rest of the message a callout
          const rest = (callout[2] ?? "") + src.slice(lineEnd);
          out.push({ type: "alert", kind: callout[1]!.toLowerCase() as AlertKind, children: parseBlocks(trimBlankLines(rest), depth + 1, notes) });
        } else {
          out.push({ type: "quote", children: parseInline(body, 0) });
        }
        i = src.length;
        continue;
      }
      // > quote, and a quote whose first line is [!NOTE] is a callout -------
      if (line === ">" || line.startsWith("> ")) {
        flushPara();
        flushList();
        const content = line === ">" ? "" : line.slice(2);
        if (alert) alert.lines.push(content);
        else if (quoteLines) quoteLines.push(content);
        else {
          const callout = nested ? RE_ALERT.exec(content) : null;
          if (callout) alert = { kind: callout[1]!.toLowerCase() as AlertKind, lines: [callout[2] ?? ""] };
          else quoteLines = [content];
        }
        i = lineEnd + 1;
        continue;
      }
      const heading = RE_HEADING.exec(line);
      if (heading) {
        flushAll();
        const level = (heading[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
        const words = trimRead(heading[2] ?? "").replace(RE_HEADING_CLOSE, "");
        out.push({ type: "heading", level, children: parseInline(words, 0) });
        i = lineEnd + 1;
        continue;
      }
      const subtext = RE_SUBTEXT.exec(line);
      if (subtext) {
        flushAll();
        out.push({ type: "subtext", children: parseInline(trimRead(subtext[1] ?? ""), 0) });
        i = lineEnd + 1;
        continue;
      }
      // a note's file, on a line of its own
      const file = filesOn && line.startsWith("![") ? RE_FILE.exec(line) : null;
      if (file) {
        flushAll();
        const width = fileWidth(file[3] ? Number(file[3]) : undefined);
        out.push({ type: "file", id: file[2] ?? "", name: file[1] ?? "", ...(width ? { width } : {}) });
        i = lineEnd + 1;
        continue;
      }
      // a rule: --- or *** or ___, before lists so that `- - -` is one too
      if (RE_HR.test(line)) {
        flushAll();
        out.push({ type: "hr" });
        i = lineEnd + 1;
        continue;
      }
      const item = RE_LIST.exec(line);
      if (item) {
        const indent = columns(item[1] ?? "");
        const ordered = item[3] !== undefined;
        const start = ordered ? Number.parseInt(item[3] ?? "1", 10) : 1;
        const content = itemContent(trimRead(item[5] ?? ""));
        flushPara();
        flushQuote();
        const stack: ListFrame[] | null = lists;
        if (!stack) {
          lists = [{ ordered, start, items: [content], indent }];
        } else {
          // Back out of the lists this item is not further in than: an item
          // belongs to the deepest list whose parent item it is indented past.
          while (stack.length > 1 && indent <= stack[stack.length - 2]!.indent) closeFrame(stack);
          const top: ListFrame = stack[stack.length - 1]!;
          if (indent > top.indent && stack.length < MAX_LIST_DEPTH) {
            // further in than the item above: a list inside that item
            stack.push({ ordered, start, items: [content], indent });
          } else {
            if (top.ordered === ordered) top.items.push(content);
            else if (stack.length === 1) {
              // switching marker kind starts a new list
              flushList();
              lists = [{ ordered, start, items: [content], indent }];
            } else {
              closeFrame(stack);
              stack.push({ ordered, start, items: [content], indent });
            }
          }
        }
        i = lineEnd + 1;
        continue;
      }
      // ::: details Summary … ::: ------------------------------------------
      const details = nested ? RE_DETAILS_OPEN.exec(line) : null;
      if (details) {
        flushAll();
        const body = detailsBody(src, lineEnd);
        out.push({
          type: "details",
          summary: parseInline(trimRead(details[1] ?? ""), 0),
          children: parseBlocks(trimBlankLines(body.content), depth + 1, notes),
        });
        i = body.end;
        continue;
      }
      // [^1]: a footnote ---------------------------------------------------
      const def = RE_FOOTNOTE_DEF.exec(line);
      if (def) {
        flushAll();
        const label = (def[1] ?? "").toLowerCase();
        const children = parseInline(line.slice(def[0].length), 0);
        // shown as typed until something refers to it
        const shown: Node[] = [{ type: "text", text: def[0] }, ...children];
        mergeText(shown);
        const node: Node = { type: "paragraph", children: shown };
        out.push(node);
        if (!notes.has(label)) notes.set(label, { node, shown, parent: out, children });
        i = lineEnd + 1;
        continue;
      }
      // | a | b | over |---|---| is a table ----------------------------------
      const table = readTable(src, i, lineEnd);
      if (table) {
        flushAll();
        out.push(table.node);
        i = table.end;
        continue;
      }
    }

    // plain paragraph line ---------------------------------------------------
    flushQuote();
    flushList();
    paraLines.push(line);
    i = lineEnd + 1;
    atLineStart = true;
  }

  flushAll();
  return out;
}

/** The inside of a callout or collapsible section, without the blank lines around it. */
function trimBlankLines(src: string): string {
  // the editor keeps the spaces at the end of the last line, as everywhere else
  const end = exactOn && src.trim() !== "" ? src.replace(/(?:\n[ \t]*)+$/, "") : src.trimEnd();
  return end.replace(/^(?:[ \t]*\n)+/, "");
}

/** Where a fenced code block starting at `start` ends, as readFence sees it. */
/**
 * A fenced code block starting at `start`: its language, where its code
 * starts and ends, and the index after it. Three backticks close at the next
 * three, as they always have; a longer fence waits for a run as long as
 * itself, so code that holds ``` can still be fenced.
 */
function scanFence(src: string, start: number): { lang: string | null; from: number; to: number; end: number } {
  const width = Math.max(3, runOf(src, start, "`"));
  const afterFence = start + width;
  RE_FENCE_LANG.lastIndex = afterFence;
  const langRaw = RE_FENCE_LANG.exec(src)?.[0] ?? "";
  const langEnd = afterFence + langRaw.length;
  const eol = src.indexOf("\n", langEnd);
  const lineEnd = eol < 0 ? src.length : eol;

  let lang: string | null;
  let from: number;
  if (src.slice(langEnd, lineEnd).trim() === "") {
    lang = langRaw === "" ? null : langRaw;
    from = eol < 0 ? src.length : eol + 1;
  } else {
    // Not a language token, e.g. ```code``` on a single line: it is content.
    lang = null;
    from = afterFence;
  }
  const close = src.indexOf("`".repeat(width), from);
  return close < 0 ? { lang, from, to: src.length, end: src.length } : { lang, from, to: close, end: close + width };
}

function fenceEnd(src: string, start: number): number {
  return scanFence(src, start).end;
}

/** Reads a fenced code block starting at `start`; returns the index after it. */
function readFence(src: string, start: number, out: Node[]): number {
  const fence = scanFence(src, start);
  let text = src.slice(fence.from, fence.to);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  out.push({ type: "codeblock", lang: fence.lang, text });
  return fence.end;
}

/**
 * The lines of a `::: details` section whose opening line ends at `lineEnd`,
 * up to the `:::` that closes it: sections inside it are counted, and code
 * blocks are stepped over, so a `:::` in either does not end it. Without a
 * closing line it runs to the end of the message, like a code block.
 */
function detailsBody(src: string, lineEnd: number): { content: string; end: number } {
  const from = lineEnd + 1;
  let open = 1;
  let k = from;
  while (k < src.length) {
    const eol = src.indexOf("\n", k);
    const le = eol < 0 ? src.length : eol;
    const l = src.slice(k, le);
    if (l.startsWith("```")) {
      const after = fenceEnd(src, k);
      const next = src.indexOf("\n", after);
      k = next < 0 ? src.length : next + 1;
      continue;
    }
    if (RE_DETAILS_OPEN.test(l)) open += 1;
    else if (RE_DETAILS_CLOSE.test(l)) {
      open -= 1;
      // the lines between, without the line break before the closing line
      if (open === 0) return { content: src.slice(from, Math.max(from, k - 1)), end: le + 1 };
    }
    k = le + 1;
  }
  return { content: src.slice(from), end: src.length };
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

/** Whether a line has a `|` that is not escaped. */
function hasPipe(line: string): boolean {
  for (let j = line.indexOf("|"); j >= 0; j = line.indexOf("|", j + 1)) {
    let slashes = 0;
    while (j - slashes - 1 >= 0 && line.charAt(j - slashes - 1) === "\\") slashes += 1;
    if (slashes % 2 === 0) return true;
  }
  return false;
}

/**
 * A table row's cells. A pipe inside inline code, an escaped `\|` and a
 * ||spoiler|| do not split a cell, so none of them needs escaping in a table.
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = 0;
  let j = 0;
  while (j < s.length && cells.length <= MAX_TABLE_COLS) {
    const c = s.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      j = skipCode(s, j);
      continue;
    }
    if (c === "|") {
      if (s.charAt(j + 1) === "|" && isNonSpace(at(s, j + 2)) && s.charAt(j + 2) !== "|") {
        const close = findPair(s, j + 2, "|");
        if (close > j + 2) {
          j = close + 2;
          continue;
        }
      }
      cells.push(cellText(s.slice(cur, j)));
      cur = j + 1;
      j += 1;
      continue;
    }
    j += 1;
  }
  if (cells.length <= MAX_TABLE_COLS) cells.push(cellText(s.slice(cur)));
  return cells;
}

/**
 * A cell's words. The editor writes a cell with one space of padding on each
 * side (`| words |`) and reads exactly that back off, so a space typed at the
 * end of a cell stays; shown messages trim cells.
 */
function cellText(raw: string): string {
  if (!exactOn || raw.trim() === "") return raw.trim();
  let s = raw;
  if (s.startsWith(" ")) s = s.slice(1);
  if (s.endsWith(" ")) s = s.slice(0, -1);
  return s;
}

/** The alignment row under a table's header, or null when the line is not one. */
function delimiterRow(line: string): Align[] | null {
  if (!hasPipe(line) || !line.includes("-")) return null;
  const cells = splitRow(line);
  const out: Align[] = [];
  for (const cell of cells) {
    if (!RE_DELIM_CELL.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    out.push(left && right ? "center" : left ? "left" : right ? "right" : null);
  }
  return out;
}

/** Whether a line would start a block of its own, which ends a table. */
function startsBlock(line: string): boolean {
  return (filesOn && RE_FILE.test(line)) || line.startsWith("```") || line === ">" || line.startsWith("> ") || line.startsWith(">>>") || RE_HEADING.test(line) || RE_SUBTEXT.test(line) || RE_HR.test(line) || RE_LIST.test(line) || RE_DETAILS_OPEN.test(line) || RE_DETAILS_CLOSE.test(line);
}

/**
 * A GitHub table: a header row, the row of dashes that says how each column
 * lines up, and the rows under them up to the first line without a pipe.
 */
function readTable(src: string, i: number, lineEnd: number): { node: Node; end: number } | null {
  const header = src.slice(i, lineEnd);
  if (lineEnd >= src.length || !hasPipe(header)) return null;
  const nextEnd = src.indexOf("\n", lineEnd + 1);
  const second = src.slice(lineEnd + 1, nextEnd < 0 ? src.length : nextEnd);
  const align = delimiterRow(second);
  if (!align) return null;
  const headCells = splitRow(header);
  // wider than the cap, it stays text rather than losing columns
  if (headCells.length !== align.length || headCells.length > MAX_TABLE_COLS) return null;
  const width = align.length;
  const cells = (raw: string[]): Node[][] => {
    const row: Node[][] = [];
    for (let c = 0; c < width; c++) row.push(parseLine(raw[c] ?? "", 0));
    return row;
  };
  const rows: Node[][][] = [];
  let k = nextEnd < 0 ? src.length : nextEnd + 1;
  while (k < src.length) {
    const eol = src.indexOf("\n", k);
    const le = eol < 0 ? src.length : eol;
    const l = src.slice(k, le);
    if (l.trim() === "" || !hasPipe(l) || startsBlock(l)) break;
    rows.push(cells(splitRow(l)));
    k = le + 1;
  }
  return { node: { type: "table", align, head: cells(headCells), rows }, end: Math.min(k, src.length + 1) };
}

// ---------------------------------------------------------------------------
// footnotes
// ---------------------------------------------------------------------------

/**
 * Numbers the footnote references in the order they are first met, moves the
 * notes they point to into a list at the end, and turns a reference with no
 * note back into the text it was. A note nothing refers to stays where it was
 * written, as typed: a line of a message never vanishes.
 */
function resolveFootnotes(nodes: Node[], notes: Notes): Node[] {
  const numbers = new Map<string, number>();
  const order: string[] = [];
  // the notes as written are read after the text, so references in the text come first
  const written = new Set<Node>();
  for (const note of notes.values()) written.add(note.node);
  const walk = (list: Node[], level: number): void => {
    if (level > 64) return;
    let merge = false;
    for (let k = 0; k < list.length; k++) {
      const node = list[k]!;
      if (written.has(node)) continue;
      switch (node.type) {
        case "footnoteRef": {
          const label = node.label.toLowerCase();
          if (!notes.has(label)) {
            list[k] = { type: "text", text: "[^" + node.label + "]" };
            merge = true;
            break;
          }
          let n = numbers.get(label);
          if (n === undefined) {
            n = order.length + 1;
            numbers.set(label, n);
            order.push(label);
          }
          list[k] = { ...node, n };
          break;
        }
        case "list":
          for (const item of node.items) walk(item, level + 1);
          break;
        case "table":
          for (const cell of node.head) walk(cell, level + 1);
          for (const row of node.rows) for (const cell of row) walk(cell, level + 1);
          break;
        case "details":
          walk(node.summary, level + 1);
          walk(node.children, level + 1);
          break;
        default:
          if ("children" in node) walk(node.children, level + 1);
      }
    }
    if (merge) mergeText(list);
  };
  walk(nodes, 0);
  // A note is written like the rest of the message, so it may refer to a note
  // too: each numbered note is read in turn, which can number more of them.
  let read = 0;
  const drain = (): void => {
    for (; read < order.length; read++) walk(notes.get(order[read]!)!.children, 1);
  };
  drain();
  for (const [label, note] of notes) {
    if (numbers.has(label)) continue;
    // left as typed, but what it refers to still works
    walk(note.shown, 1);
    drain();
  }
  if (order.length === 0) return nodes;
  const found: { label: string; n: number; children: Node[] }[] = [];
  for (const label of order) {
    const note = notes.get(label)!;
    const at = note.parent.indexOf(note.node);
    if (at >= 0) note.parent.splice(at, 1);
    found.push({ label, n: numbers.get(label)!, children: note.children });
  }
  nodes.push({ type: "footnotes", notes: found });
  return nodes;
}

/** Joins neighbouring text nodes, after references without a note became text. */
function mergeText(list: Node[]): void {
  for (let k = list.length - 1; k > 0; k--) {
    const a = list[k - 1]!;
    const b = list[k]!;
    if (a.type === "text" && b.type === "text") {
      list[k - 1] = { type: "text", text: a.text + b.text };
      list.splice(k, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// inline level
// ---------------------------------------------------------------------------

function parseInline(src: string, depth: number): Node[] {
  const out: Node[] = [];
  let start = 0;
  for (;;) {
    const nl = src.indexOf("\n", start);
    const line = nl < 0 ? src.slice(start) : src.slice(start, nl);
    for (const node of parseLine(line, depth)) out.push(node);
    if (nl < 0) break;
    out.push({ type: "br" });
    start = nl + 1;
  }
  return out;
}

function wrapEmphasis(ch: string, want: number, children: Node[]): Node {
  if (ch === "*") {
    if (want >= 3) return { type: "strong", children: [{ type: "em", children }] };
    return want === 2 ? { type: "strong", children } : { type: "em", children };
  }
  if (want >= 3) return { type: "u", children: [{ type: "em", children }] };
  return want === 2 ? { type: "u", children } : { type: "em", children };
}

function parseLine(line: string, depth: number): Node[] {
  const out: Node[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };
  // Remembers the earliest position from which a closer search failed; any
  // later search for the same marker must fail too, so we skip the rescan.
  const failed = new Map<string, number>();

  let i = 0;
  while (i < line.length) {
    const c = line.charAt(i);

    // escapes ---------------------------------------------------------------
    if (c === "\\" && i + 1 < line.length) {
      const next = line.charAt(i + 1);
      if (RE_PUNCT.test(next)) {
        buf += next;
        i += 2;
        continue;
      }
    }

    // inline code -----------------------------------------------------------
    if (c === "`") {
      const run = runOf(line, i, "`");
      const close = findBacktickClose(line, i + run, run);
      if (close >= 0) {
        flush();
        out.push({ type: "code", text: line.slice(i + run, close) });
        i = close + run;
        continue;
      }
      buf += line.slice(i, i + run);
      i += run;
      continue;
    }

    // <...> constructs -------------------------------------------------------
    if (c === "<") {
      const node = readAngle(line, i);
      if (node) {
        flush();
        out.push(node.node);
        i = node.end;
        continue;
      }
    }

    // :shortcode: names, the ones people type everywhere else -----------------
    if (c === ":") {
      RE_SHORTCODE.lastIndex = i;
      const m = RE_SHORTCODE.exec(line);
      if (m) {
        const emoji = shortcodeToEmoji(m[1]!);
        if (emoji) {
          flush();
          out.push({ type: "unicodeEmoji", text: emoji });
          i = RE_SHORTCODE.lastIndex;
          continue;
        }
      }
    }

    // unicode emoji (before markers so that *⃣ keycaps win) --------------
    const cc = line.charCodeAt(i);
    if (cc === 35 || cc === 42 || (cc >= 48 && cc <= 57) || cc >= 0xa9) {
      RE_UNICODE_EMOJI.lastIndex = i;
      const m = RE_UNICODE_EMOJI.exec(line);
      if (m && m[0].length > 0) {
        flush();
        out.push({ type: "unicodeEmoji", text: m[0] });
        i += m[0].length;
        continue;
      }
    }

    // ^{superscript} and _{subscript} ----------------------------------------
    if ((c === "^" || c === "_") && at(line, i + 1) === "{" && depth < MAX_DEPTH) {
      const close = closeBrace(line, i + 1);
      if (close > i + 2 && line.slice(i + 2, close).trim() !== "") {
        flush();
        out.push({ type: c === "^" ? "sup" : "sub", children: parseLine(line.slice(i + 2, close), depth + 1) });
        i = close + 1;
        continue;
      }
    }

    // * _ emphasis -----------------------------------------------------------
    if ((c === "*" || c === "_") && depth < MAX_DEPTH) {
      const run = runOf(line, i, c);
      const want = Math.min(run, 3);
      let canOpen = isNonSpace(at(line, i + want));
      if (c === "_") canOpen = canOpen && !isWordChar(at(line, i - 1));
      if (canOpen) {
        const close = findCloser(line, i + want, c, want, failed);
        if (close >= 0) {
          flush();
          out.push(wrapEmphasis(c, want, parseLine(line.slice(i + want, close), depth + 1)));
          i = close + want;
          continue;
        }
      }
      buf += line.slice(i, i + run);
      i += run;
      continue;
    }

    // ~~strike~~ and ||spoiler|| ---------------------------------------------
    if ((c === "~" || c === "|") && at(line, i + 1) === c && depth < MAX_DEPTH) {
      const close = findPair(line, i + 2, c);
      if (close >= 0) {
        flush();
        out.push({
          type: c === "~" ? "s" : "spoiler",
          children: parseLine(line.slice(i + 2, close), depth + 1),
        });
        i = close + 2;
        continue;
      }
      buf += c + c;
      i += 2;
      continue;
    }

    // ==highlight== ------------------------------------------------------------
    // Only between words' edges, so `a==b` and `x == y` stay as written.
    if (c === "=" && at(line, i + 1) === "=") {
      const run = runOf(line, i, "=");
      const next = at(line, i + 2);
      if (run === 2 && depth < MAX_DEPTH && isNonSpace(next) && !isWordChar(at(line, i - 1))) {
        const close = findMarkClose(line, i + 2, failed);
        if (close >= 0) {
          flush();
          out.push({ type: "mark", children: parseLine(line.slice(i + 2, close), depth + 1) });
          i = close + 2;
          continue;
        }
      }
      buf += line.slice(i, i + run);
      i += run;
      continue;
    }

    // @everyone / @here ------------------------------------------------------
    if (c === "@" && !isWordChar(at(line, i - 1))) {
      if (line.startsWith("@everyone", i)) {
        flush();
        out.push({ type: "mention", kind: "everyone" });
        i += 9;
        continue;
      }
      if (line.startsWith("@here", i)) {
        flush();
        out.push({ type: "mention", kind: "here" });
        i += 5;
        continue;
      }
    }

    // [words]{colour}, [masked](link) and [^footnote] ----------------------------
    if (c === "[" && depth < MAX_DEPTH) {
      const hit = readBracket(line, i, depth);
      if (hit) {
        flush();
        for (const node of hit.nodes) out.push(node);
        i = hit.end;
        continue;
      }
    }

    // bare url ---------------------------------------------------------------
    if (c === "h" || c === "H") {
      RE_URL.lastIndex = i;
      const m = RE_URL.exec(line);
      if (m) {
        const url = trimUrl(m[0]);
        if (RE_HTTP.test(url)) {
          flush();
          out.push({ type: "link", url, children: [{ type: "text", text: url }], masked: false, noEmbed: false });
          i += url.length;
          continue;
        }
      }
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

interface Hit {
  nodes: Node[];
  end: number;
}

/**
 * What a `[` starts: coloured words, a masked link or a footnote reference.
 * A colour's words may hold a link, and a link's label may hold a colour,
 * so both accept one level of [brackets] inside; a masked link is otherwise
 * read exactly as it always was.
 */
function readBracket(line: string, i: number, depth: number): Hit | null {
  const close = closeBracket(line, i);
  if (close > i && line.charAt(close + 1) === "{") {
    RE_COLOR_BRACES.lastIndex = close + 1;
    const m = RE_COLOR_BRACES.exec(line);
    const spec = m ? parseColorSpec(m[1] ?? "") : null;
    if (m && spec) {
      return { nodes: [{ type: "color", fg: spec.fg, bg: spec.bg, children: parseLine(line.slice(i + 1, close), depth + 1) }], end: RE_COLOR_BRACES.lastIndex };
    }
  }
  RE_MASKED.lastIndex = i;
  const m = RE_MASKED.exec(line);
  if (m) {
    const hit = maskedLink(m[1] ?? "", m[2] ?? "", RE_MASKED.lastIndex, depth);
    if (hit) return hit;
  }
  if (close > i && line.charAt(close + 1) === "(") {
    RE_DEST.lastIndex = close + 1;
    const d = RE_DEST.exec(line);
    if (d) {
      const hit = maskedLink(line.slice(i + 1, close), d[1] ?? "", RE_DEST.lastIndex, depth);
      if (hit) return hit;
    }
  }
  if (line.charAt(i + 1) === "^") {
    RE_FOOTNOTE_REF.lastIndex = i;
    const f = RE_FOOTNOTE_REF.exec(line);
    // numbered, or turned back into text, once the whole message is read
    if (f) return { nodes: [{ type: "footnoteRef", label: f[1] ?? "", n: 0 }], end: RE_FOOTNOTE_REF.lastIndex };
  }
  return null;
}

function maskedLink(label: string, raw: string, end: number, depth: number): Hit | null {
  const angled = raw.startsWith("<") && raw.endsWith(">");
  const url = angled ? raw.slice(1, -1) : raw;
  if (!RE_HTTP.test(url)) return null;
  if (misleadingLabel(label, url)) {
    // the label says one site and the link goes to another: both are
    // shown, the real address as the link
    return {
      nodes: [
        ...parseLine(label, depth + 1),
        { type: "text", text: " (" },
        { type: "link", url, children: [{ type: "text", text: url }], masked: false, noEmbed: angled },
        { type: "text", text: ")" },
      ],
      end,
    };
  }
  return { nodes: [{ type: "link", url, children: parseLine(label, depth + 1), masked: true, noEmbed: angled }], end };
}

/**
 * The `]` that closes the `[` at `i`, within MAX_LABEL characters, with one
 * level of brackets allowed inside and escaped ones skipped; -1 if none.
 */
function closeBracket(line: string, i: number): number {
  const end = Math.min(line.length, i + MAX_LABEL + 2);
  let depth = 0;
  for (let j = i; j < end; j++) {
    const c = line.charAt(j);
    if (c === "\\") {
      j += 1;
    } else if (c === "[") {
      depth += 1;
      if (depth > 2) return -1;
    } else if (c === "]") {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * The `}` that closes the `{` at `i`, within MAX_BRACE characters, counting
 * braces inside and skipping escaped ones and inline code; -1 if none.
 */
function closeBrace(line: string, i: number): number {
  const window = line.slice(i, i + MAX_BRACE + 2);
  let depth = 0;
  for (let j = 0; j < window.length; j++) {
    const c = window.charAt(j);
    if (c === "\\") {
      j += 1;
    } else if (c === "`") {
      j = skipCode(window, j) - 1;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + j;
    }
  }
  return -1;
}

interface AngleHit {
  node: Node;
  end: number;
}

function readAngle(line: string, i: number): AngleHit | null {
  RE_ROLE.lastIndex = i;
  let m = RE_ROLE.exec(line);
  if (m) return { node: { type: "mention", kind: "role", id: m[1] ?? "" }, end: RE_ROLE.lastIndex };

  RE_USER.lastIndex = i;
  m = RE_USER.exec(line);
  if (m) return { node: { type: "mention", kind: "user", id: m[1] ?? "" }, end: RE_USER.lastIndex };

  RE_CHANNEL.lastIndex = i;
  m = RE_CHANNEL.exec(line);
  if (m) return { node: { type: "mention", kind: "channel", id: m[1] ?? "" }, end: RE_CHANNEL.lastIndex };

  RE_CUSTOM_EMOJI.lastIndex = i;
  m = RE_CUSTOM_EMOJI.exec(line);
  if (m) {
    return {
      node: { type: "emoji", name: m[2] ?? "", id: m[3] ?? "", animated: m[1] === "a" },
      end: RE_CUSTOM_EMOJI.lastIndex,
    };
  }

  RE_TIMESTAMP.lastIndex = i;
  m = RE_TIMESTAMP.exec(line);
  if (m) {
    const unix = Number.parseInt(m[1] ?? "0", 10);
    const style = (m[2] ?? "f") as "t" | "T" | "d" | "D" | "f" | "F" | "R";
    return { node: { type: "timestamp", unix, style }, end: RE_TIMESTAMP.lastIndex };
  }

  RE_ANGLE_URL.lastIndex = i;
  m = RE_ANGLE_URL.exec(line);
  if (m) {
    const url = m[1] ?? "";
    return {
      node: { type: "link", url, children: [{ type: "text", text: url }], masked: false, noEmbed: true },
      end: RE_ANGLE_URL.lastIndex,
    };
  }
  return null;
}

function findBacktickClose(line: string, from: number, run: number): number {
  let j = from;
  while (j < line.length) {
    const k = line.indexOf("`", j);
    if (k < 0) return -1;
    const len = runOf(line, k, "`");
    if (len === run) return k;
    j = k + len;
  }
  return -1;
}

/** Skips over an inline code span so markers inside it never close a run. */
function skipCode(line: string, j: number): number {
  const run = runOf(line, j, "`");
  const close = findBacktickClose(line, j + run, run);
  return close >= 0 ? close + run : j + run;
}

function findCloser(line: string, from: number, ch: string, want: number, failed: Map<string, number>): number {
  const key = ch + String(want);
  const mark = failed.get(key);
  if (mark !== undefined && from >= mark) return -1;
  let j = from;
  while (j < line.length) {
    const cj = line.charAt(j);
    if (cj === "\\") {
      j += 2;
      continue;
    }
    if (cj === "`") {
      j = skipCode(line, j);
      continue;
    }
    if (cj !== ch) {
      j += 1;
      continue;
    }
    const run = runOf(line, j, ch);
    if (run >= want) {
      let ok = isNonSpace(at(line, j - 1));
      if (ch === "_") ok = ok && !isWordChar(at(line, j + run));
      const startOfCloser = j + run - want;
      if (ok && startOfCloser >= from) return startOfCloser;
    }
    j += run;
  }
  failed.set(key, mark === undefined ? from : Math.min(mark, from));
  return -1;
}

/** The `==` that closes a highlight: exactly two, after a non-space and not before a word. */
function findMarkClose(line: string, from: number, failed: Map<string, number>): number {
  const mark = failed.get("=");
  if (mark !== undefined && from >= mark) return -1;
  let j = from;
  while (j < line.length) {
    const cj = line.charAt(j);
    if (cj === "\\") {
      j += 2;
      continue;
    }
    if (cj === "`") {
      j = skipCode(line, j);
      continue;
    }
    if (cj !== "=") {
      j += 1;
      continue;
    }
    const run = runOf(line, j, "=");
    if (run === 2 && j > from && isNonSpace(at(line, j - 1)) && !isWordChar(at(line, j + 2))) return j;
    j += run;
  }
  failed.set("=", mark === undefined ? from : Math.min(mark, from));
  return -1;
}

function findPair(line: string, from: number, ch: string): number {
  let j = from;
  while (j < line.length) {
    const cj = line.charAt(j);
    if (cj === "\\") {
      j += 2;
      continue;
    }
    if (cj === "`") {
      j = skipCode(line, j);
      continue;
    }
    if (cj === ch && at(line, j + 1) === ch) {
      if (j > from) return j;
      j += 2;
      continue;
    }
    j += 1;
  }
  return -1;
}

/** Drops trailing sentence punctuation and unbalanced closing brackets. */
export function trimUrl(url: string): string {
  // the brackets are counted once and kept up to date as the end moves back,
  // so a long run of them costs no more than its length
  let open = 0;
  let close = 0;
  let openSq = 0;
  let closeSq = 0;
  for (let k = 0; k < url.length; k++) {
    const c = url.charAt(k);
    if (c === "(") open += 1;
    else if (c === ")") close += 1;
    else if (c === "[") openSq += 1;
    else if (c === "]") closeSq += 1;
  }
  let end = url.length;
  while (end > 0) {
    const last = url.charAt(end - 1);
    if (last === "." || last === "," || last === ";" || last === ":" || last === "!" || last === "?") {
      end -= 1;
      continue;
    }
    if (last === ")" && close > open) {
      close -= 1;
      end -= 1;
      continue;
    }
    if (last === "]" && closeSq > openSq) {
      closeSq -= 1;
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

// ---------------------------------------------------------------------------
// derived helpers
// ---------------------------------------------------------------------------

/** True when a message is nothing but (at most 30) emoji, so it renders jumbo. */
export function isEmojiOnly(nodes: Node[]): boolean {
  let count = 0;
  let ok = true;
  const walk = (list: Node[]): void => {
    for (const node of list) {
      if (!ok) return;
      switch (node.type) {
        case "emoji":
        case "unicodeEmoji":
          count += 1;
          break;
        case "text":
          if (node.text.trim() !== "") ok = false;
          break;
        case "br":
          break;
        case "paragraph":
          walk(node.children);
          break;
        default:
          ok = false;
      }
    }
  };
  walk(nodes);
  return ok && count >= 1 && count <= MAX_JUMBO_EMOJI;
}

/** Names for mentions; without them a mention flattens to its raw id. */
export type PlainTextNames = Pick<RenderCtx, "users" | "channels" | "roles">;

const ALERT_TITLE: Record<AlertKind, string> = {
  note: "render.alert.note",
  tip: "render.alert.tip",
  important: "render.alert.important",
  warning: "render.alert.warning",
  caution: "render.alert.caution",
};

/** A callout's title in the reader's language: Note, Tip, Important, Warning, Caution. */
export function alertTitle(kind: AlertKind): string {
  return t(ALERT_TITLE[kind]);
}

function inlineText(list: Node[], names?: PlainTextNames): string {
  return list.map((child) => nodeText(child, names)).join("");
}

function nodeText(node: Node, names?: PlainTextNames): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "br":
      return "\n";
    case "code":
    case "codeblock":
      return node.text;
    case "strong":
    case "em":
    case "u":
    case "s":
    case "mark":
    case "sup":
    case "sub":
    case "color":
    case "paragraph":
    case "quote":
    case "heading":
    case "subtext":
      return inlineText(node.children, names);
    case "spoiler":
      // replies and notifications must not give away what it hides
      return t("render.spoiler");
    case "list":
      return node.items
        .map((item) => item.map((child) => (child.type === "list" ? "\n" + nodeText(child, names) : nodeText(child, names))).join(""))
        .join("\n");
    case "task":
      // a box, ticked or not, as a line of a checklist reads in plain text
      return node.checked ? "☑ " : "☐ ";
    case "hr":
      return "---";
    case "file":
      return node.name;
    case "table":
      return [node.head, ...node.rows].map((row) => row.map((cell) => inlineText(cell, names)).join(" | ")).join("\n");
    case "alert": {
      const body = plainText(node.children, names);
      return alertTitle(node.kind) + (body ? ": " + body : "");
    }
    case "details": {
      const summary = inlineText(node.summary, names) || t("render.details");
      const body = plainText(node.children, names);
      return summary + (body ? "\n" + body : "");
    }
    case "footnoteRef":
      return "[" + String(node.n) + "]";
    case "footnotes":
      return node.notes.map((note) => "[" + String(note.n) + "] " + inlineText(note.children, names)).join("\n");
    case "link":
      return node.url;
    case "mention":
      switch (node.kind) {
        case "everyone":
          return "@everyone";
        case "here":
          return "@here";
        case "channel":
          return "#" + (names ? names.channels[node.id]?.name || t("render.unknownChannel") : node.id);
        case "user": {
          if (!names) return "@" + node.id;
          const user = names.users[node.id];
          return "@" + (user ? user.display_name || user.username || t("render.unknownUser") : t("render.unknownUser"));
        }
        default:
          return "@" + (names ? names.roles?.[node.id]?.name || t("render.unknownRole") : node.id);
      }
    case "emoji":
      return ":" + node.name + ":";
    case "unicodeEmoji":
      return node.text;
    case "timestamp":
      return "<t:" + String(node.unix) + ":" + node.style + ">";
  }
}

/** Human-readable flattening used for notifications, replies and search. */
export function plainText(nodes: Node[], names?: PlainTextNames): string {
  let out = "";
  for (const node of nodes) {
    if (BLOCK_TYPES.has(node.type) && out !== "" && !out.endsWith("\n")) out += "\n";
    out += nodeText(node, names);
  }
  return out;
}

/** The http(s) urls that would produce an embed, in order, deduped, max five. */
export function extractUrls(src: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (list: Node[]): void => {
    for (const node of list) {
      if (out.length >= MAX_URLS) return;
      switch (node.type) {
        case "link":
          if (!node.noEmbed && RE_HTTP.test(node.url) && !seen.has(node.url)) {
            seen.add(node.url);
            out.push(node.url);
          }
          break;
        case "strong":
        case "em":
        case "u":
        case "s":
        case "mark":
        case "sup":
        case "sub":
        case "color":
        case "paragraph":
        case "quote":
        case "heading":
        case "subtext":
        case "alert":
          walk(node.children);
          break;
        case "list":
          for (const item of node.items) walk(item);
          break;
        case "table":
          for (const cell of node.head) walk(cell);
          for (const row of node.rows) for (const cell of row) walk(cell);
          break;
        case "footnotes":
          for (const note of node.notes) walk(note.children);
          break;
        // a preview would show what the spoiler hides, or open what the
        // author folded away
        case "spoiler":
        case "details":
        default:
          break;
      }
    }
  };
  walk(parse(src));
  return out;
}
