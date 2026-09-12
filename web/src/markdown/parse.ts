import type { Node } from "./ast";

// ---------------------------------------------------------------------------
// Discord-flavoured markdown parser.
//
// The parser is a single left-to-right scan. Block constructs are recognised at
// line starts only; inline constructs are parsed one line at a time, which is
// what makes `**a\nb**` stay literal the way Discord renders it. Recursion is
// capped so that adversarial input can neither blow the stack nor go quadratic.
// ---------------------------------------------------------------------------

/** Nesting cap for inline constructs; keeps the parser linear on marker soup. */
const MAX_DEPTH = 24;
/** Discord shows at most five embeds per message. */
const MAX_URLS = 5;
/** Above this many emoji a message is no longer rendered jumbo. */
const MAX_JUMBO_EMOJI = 30;

const RE_USER = /<@!?(\d{1,32})>/y;
const RE_CHANNEL = /<#(\d{1,32})>/y;
const RE_ROLE = /<@&(\d{1,32})>/y;
const RE_CUSTOM_EMOJI = /<(a)?:([a-zA-Z0-9_]{2,32}):(\d{1,32})>/y;
const RE_TIMESTAMP = /<t:(-?\d{1,19})(?::([tTdDfFR]))?>/y;
const RE_ANGLE_URL = /<(https?:\/\/[^\s>]+)>/iy;
const RE_URL = /https?:\/\/[^\s<]+/iy;
const RE_MASKED = /\[([^\]\n]*)\]\(\s*(<[^>\s]+>|[^()\s]+)\s*\)/y;
const RE_FENCE_LANG = /[a-zA-Z0-9_+-]*/y;
const RE_HEADING = /^(#{1,3}) (.*)$/;
const RE_SUBTEXT = /^-# (.*)$/;
const RE_LIST = /^( *)(?:([-*])|(\d{1,9})\.) +(.*)$/;
const RE_PUNCT = /[!-/:-@[-`{-~]/;
const RE_WORD = /[\p{L}\p{N}_]/u;
const RE_HTTP = /^https?:\/\/\S/i;
const RE_UNICODE_EMOJI =
  /(?:\p{RI}\p{RI}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/uy;

const BLOCK_TYPES = new Set(["paragraph", "quote", "heading", "subtext", "list", "codeblock"]);

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
 * (headings, lists, quotes, fenced code) is disabled, which is what message
 * previews want; newlines still become `br` nodes.
 */
export function parse(src: string, opts?: { inline?: boolean }): Node[] {
  const text = normalize(src);
  if (text === "") return [];
  return opts?.inline ? parseInline(text, 0) : parseBlocks(text);
}

function normalize(src: string): string {
  return src.replace(/\r\n?/g, "\n").replace(/\s+$/, "").replace(/^\n+/, "");
}

// ---------------------------------------------------------------------------
// block level
// ---------------------------------------------------------------------------

interface ListAcc {
  ordered: boolean;
  start: number;
  items: Node[][];
  nested: ListAcc | null;
}

function newList(ordered: boolean, start: number): ListAcc {
  return { ordered, start, items: [], nested: null };
}

function attachNested(acc: ListAcc): void {
  const nested = acc.nested;
  if (!nested) return;
  acc.nested = null;
  const last = acc.items[acc.items.length - 1];
  if (last) last.push(listNode(nested));
  else acc.items.push([listNode(nested)]);
}

function listNode(acc: ListAcc): Node {
  attachNested(acc);
  return { type: "list", ordered: acc.ordered, start: acc.start, items: acc.items };
}

function parseBlocks(src: string): Node[] {
  const out: Node[] = [];
  let paraLines: string[] = [];
  let quoteLines: string[] | null = null;
  let list: ListAcc | null = null;

  const flushPara = (): void => {
    if (paraLines.length === 0) return;
    out.push({ type: "paragraph", children: parseInline(paraLines.join("\n"), 0) });
    paraLines = [];
  };
  const flushQuote = (): void => {
    if (!quoteLines) return;
    out.push({ type: "quote", children: parseInline(quoteLines.join("\n"), 0) });
    quoteLines = null;
  };
  const flushList = (): void => {
    if (!list) return;
    out.push(listNode(list));
    list = null;
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
        out.push({ type: "quote", children: parseInline(body, 0) });
        i = src.length;
        continue;
      }
      // > quote -------------------------------------------------------------
      if (line === ">" || line.startsWith("> ")) {
        flushPara();
        flushList();
        if (!quoteLines) quoteLines = [];
        quoteLines.push(line === ">" ? "" : line.slice(2));
        i = lineEnd + 1;
        continue;
      }
      const heading = RE_HEADING.exec(line);
      if (heading) {
        flushAll();
        const level = heading[1]?.length === 1 ? 1 : heading[1]?.length === 2 ? 2 : 3;
        out.push({ type: "heading", level, children: parseInline((heading[2] ?? "").trim(), 0) });
        i = lineEnd + 1;
        continue;
      }
      const subtext = RE_SUBTEXT.exec(line);
      if (subtext) {
        flushAll();
        out.push({ type: "subtext", children: parseInline((subtext[1] ?? "").trim(), 0) });
        i = lineEnd + 1;
        continue;
      }
      const item = RE_LIST.exec(line);
      if (item) {
        const indent = (item[1] ?? "").length;
        const ordered = item[3] !== undefined;
        const start = ordered ? Number.parseInt(item[3] ?? "1", 10) : 1;
        const content = parseInline((item[4] ?? "").trim(), 0);
        const nestable = indent === 2 && list !== null && list.items.length > 0;
        if (nestable && list) {
          if (!list.nested || list.nested.ordered !== ordered) {
            attachNested(list);
            list.nested = newList(ordered, start);
          }
          list.nested.items.push(content);
        } else {
          flushPara();
          flushQuote();
          if (list && list.ordered !== ordered) flushList();
          if (!list) list = newList(ordered, start);
          else attachNested(list);
          list.items.push(content);
        }
        i = lineEnd + 1;
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

/** Reads a fenced code block starting at `start`; returns the index after it. */
function readFence(src: string, start: number, out: Node[]): number {
  const afterFence = start + 3;
  RE_FENCE_LANG.lastIndex = afterFence;
  const langRaw = RE_FENCE_LANG.exec(src)?.[0] ?? "";
  const langEnd = afterFence + langRaw.length;
  const eol = src.indexOf("\n", langEnd);
  const lineEnd = eol < 0 ? src.length : eol;

  let lang: string | null;
  let contentStart: number;
  if (src.slice(langEnd, lineEnd).trim() === "") {
    lang = langRaw === "" ? null : langRaw;
    contentStart = eol < 0 ? src.length : eol + 1;
  } else {
    // Not a language token, e.g. ```code``` on a single line: it is content.
    lang = null;
    contentStart = afterFence;
  }

  const close = src.indexOf("```", contentStart);
  let text = close < 0 ? src.slice(contentStart) : src.slice(contentStart, close);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  out.push({ type: "codeblock", lang, text });
  return close < 0 ? src.length : close + 3;
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

    // [masked](link) ---------------------------------------------------------
    if (c === "[" && depth < MAX_DEPTH) {
      RE_MASKED.lastIndex = i;
      const m = RE_MASKED.exec(line);
      if (m) {
        const end = RE_MASKED.lastIndex;
        const raw = m[2] ?? "";
        const angled = raw.startsWith("<") && raw.endsWith(">");
        const url = angled ? raw.slice(1, -1) : raw;
        if (RE_HTTP.test(url)) {
          flush();
          out.push({
            type: "link",
            url,
            children: parseLine(m[1] ?? "", depth + 1),
            masked: true,
            noEmbed: angled,
          });
          i = end;
          continue;
        }
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

function countChar(s: string, ch: string, end: number): number {
  let n = 0;
  for (let k = 0; k < end; k++) if (s.charAt(k) === ch) n += 1;
  return n;
}

/** Drops trailing sentence punctuation and unbalanced closing brackets. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url.charAt(end - 1);
    if (last === "." || last === "," || last === ";" || last === ":" || last === "!" || last === "?") {
      end -= 1;
      continue;
    }
    if (last === ")" && countChar(url, ")", end) > countChar(url, "(", end)) {
      end -= 1;
      continue;
    }
    if (last === "]" && countChar(url, "]", end) > countChar(url, "[", end)) {
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

function nodeText(node: Node): string {
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
    case "spoiler":
    case "paragraph":
    case "quote":
    case "heading":
    case "subtext":
      return node.children.map(nodeText).join("");
    case "list":
      return node.items
        .map((item) => item.map((child) => (child.type === "list" ? "\n" + nodeText(child) : nodeText(child))).join(""))
        .join("\n");
    case "link":
      return node.url;
    case "mention":
      switch (node.kind) {
        case "everyone":
          return "@everyone";
        case "here":
          return "@here";
        case "channel":
          return "#" + node.id;
        default:
          return "@" + node.id;
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
export function plainText(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (BLOCK_TYPES.has(node.type) && out !== "" && !out.endsWith("\n")) out += "\n";
    out += nodeText(node);
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
        case "spoiler":
        case "paragraph":
        case "quote":
        case "heading":
        case "subtext":
          walk(node.children);
          break;
        case "list":
          for (const item of node.items) walk(item);
          break;
        default:
          break;
      }
    }
  };
  walk(parse(src));
  return out;
}
