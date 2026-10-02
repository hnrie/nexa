import { describe, expect, it } from "vitest";
import type { Node } from "@/markdown/ast";
import { parse, plainText } from "@/markdown/parse";
import { fromMarkdown, inlineMarkdown, toMarkdown } from "./markdown";
import { MAX_INDENT, textBlock, type Block, type Inline, type Marks, type TextBlock, type Wrap } from "./model";

/**
 * An AST with what cannot be seen taken out: empty paragraphs, text split in
 * two places, and which of a colour and a link wraps the other (a coloured
 * link looks the same either way: markdown.css).
 */
function visible(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.type === "paragraph" && n.children.every((c) => c.type === "br")) continue;
    const only = n.type === "color" && n.children.length === 1 ? n.children[0] : undefined;
    if (n.type === "color" && only?.type === "link") {
      out.push(...visible([{ ...only, children: [{ ...n, children: only.children }] }]));
      continue;
    }
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text") {
      out[out.length - 1] = { type: "text", text: last.text + n.text };
      continue;
    }
    if ("children" in n && n.type !== "details") out.push({ ...n, children: visible(n.children) } as Node);
    else if (n.type === "details") out.push({ ...n, summary: visible(n.summary), children: visible(n.children) });
    else if (n.type === "list") out.push({ ...n, items: n.items.map(visible) });
    else if (n.type === "table") out.push({ ...n, head: n.head.map(visible), rows: n.rows.map((r) => r.map(visible)) });
    else if (n.type === "footnotes") out.push({ ...n, notes: n.notes.map((x) => ({ ...x, children: visible(x.children) })) });
    else out.push(n);
  }
  return out;
}

/** Markdown through the editor and back: what it shows must be what it showed. */
function roundTrip(src: string): string {
  return toMarkdown(fromMarkdown(src).blocks);
}

const CORPUS = [
  "plain words",
  "**bold** *italic* __underline__ ~~strike~~ ||spoiler|| `code` ==mark== x^{2} H_{2}O",
  "***bold italic*** and ___underline italic___ and __**both**__",
  "**bold _nested_ text** and a*b*c",
  "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n-# small print",
  "> a quote\n> on two lines",
  "> [!NOTE]\n> Read this\n> - one\n> - two",
  "> [!WARNING] Back up first",
  "> [!TIP]\n> tip\n\n> [!TIP]\n> another tip",
  "> quote\n\n> [!CAUTION]\n> careful",
  "::: details Logs\nline one\n- item\n:::",
  "::: details\nno summary\n:::\n::: details Second\nx\n:::",
  "- a\n  - b\n    - c\n- d",
  "1. one\n2. two\n   - inner\n3. three",
  "3. starts at three\n4. four",
  "- [ ] todo\n- [x] done\n  - [ ] nested",
  "| a | b | c |\n|:-|:-:|--:|\n| 1 | **2** | `x|y` |\n| ||s|| | [l](https://a.b) | |",
  "```js\nconst a = 1;\n```\ntext after",
  "````md\n```js\nx\n```\n````",
  "---\n***\n___",
  "[masked](https://example.com/x) and <https://quiet.example> and https://bare.example/path_(x)",
  "[quiet link](<https://example.com>)",
  "[red words]{red} [hex]{#ff8800} [lit]{on yellow} [both]{blue on pink}",
  "[[a link in colour](https://x.y)]{red} and [[colour in a link]{green}](https://x.y)",
  "<@123> <#456> <@&789> <:smile:111> <a:party:222> <t:1700000000:R> @everyone @here",
  "text[^1] and more[^n]\n[^1]: the first note\n[^n]: the second",
  "escapes: \\*not bold\\* \\_x\\_ \\`y\\` \\|\\| \\~\\~ \\=\\= \\^{} \\[a]{red} 1\\. \\# \\> \\-",
  "a\n\nb\n\n\nc",
  "Nexa™ ↔ ▶ ❤️ 👍🏽",
  "snake_case_word and 5 * 3 and a == b and x^y",
  "## Title with `code` and **bold**",
  "- **bold item** with [link](https://a.b)",
  "text\n| not | a table because\nof this line",
  "| lone |\n|---|\n\n| second |\n|---|",
];

describe("the formatting editor reads markdown and writes it back", () => {
  it.each(CORPUS)("keeps %j as it looks", (src) => {
    const back = roundTrip(src);
    expect(visible(parse(back)), back).toEqual(visible(parse(src)));
  });

  it("gives the same markdown when it goes round twice", () => {
    for (const src of CORPUS) {
      const once = roundTrip(src);
      expect(roundTrip(once), src).toBe(once);
    }
  });

  it("keeps a space typed at the end of any line, which a word is about to follow", () => {
    // A note written together reads its text back into the editor each time
    // someone else types; a space dropped there was dropped for everyone.
    for (const src of [
      "things:\n- sunscreen\n- board ",
      "- a \n  - nested \n- b",
      "- [x] done \n- [ ] two ",
      "1. one\n2. two ",
      "# Weekend \nplans",
      "-# small print ",
      "| a | b |\n|---|---|\n| c  | d |",
      "::: details Packing \nbring a jacket \n:::",
      "> [!NOTE]\n> the train ",
      "para \n\nnext",
    ]) {
      expect(toMarkdown(fromMarkdown(src).blocks), src).toBe(src);
    }
    // a message shown in the chat still trims them
    expect(parse("- board ")).toEqual(parse("- board"));
  });

  it("writes plain text plainly", () => {
    expect(roundTrip("just words, with punctuation! (and brackets) 50% off? yes: 10:30")).toBe("just words, with punctuation! (and brackets) 50% off? yes: 10:30");
    expect(roundTrip("snake_case_word")).toBe("snake_case_word");
  });

  it("does not show the blank line markdown needs between a quote and a callout as a line of its own", () => {
    const { blocks } = fromMarkdown("> a\n\n> [!NOTE]\n> b");
    expect(blocks.map((b) => b.wrap)).toEqual(["quote", "note"]);
    expect(toMarkdown(blocks)).toBe("> a\n\n> [!NOTE]\n> b");
    // two quotes a blank line apart stay two quotes
    expect(fromMarkdown("> a\n\n> b").blocks.map((b) => b.wrap)).toEqual(["quote", null, "quote"]);
  });

  it("says when it had to simplify something nested", () => {
    expect(fromMarkdown("> [!NOTE]\n> ::: details x\n> y\n> :::").simplified).toBe(true);
    expect(fromMarkdown("> [!NOTE]\n> plain").simplified).toBe(false);
  });

  it("names mentions and times for the editor to show", () => {
    const names = { users: { "123": { display_name: "Ada", username: "ada" } }, channels: { "456": { name: "general" } }, roles: {}, emojiUrl: (id: string) => `/e/${id}` };
    const { blocks } = fromMarkdown("<@123> <#456> <:smile:111>", names);
    const atoms = (blocks[0] as TextBlock).content.filter((r) => r.kind === "atom");
    expect(atoms.map((a) => (a.kind === "atom" ? [a.label, a.raw] : []))).toEqual([["@Ada", "<@123>"], ["#general", "<#456>"], [":smile:", "<:smile:111>"]]);
    expect(atoms[2]?.kind === "atom" && atoms[2].img).toBe("/e/111");
  });
});

// ---------------------------------------------------------------------------
// text that looks like markup stays text
// ---------------------------------------------------------------------------

const t = (text: string, marks: Marks = {}): Inline => ({ kind: "text", text, marks });
const para = (...content: Inline[]): TextBlock => textBlock("p", content);

function shown(blocks: Block[]): string {
  return plainText(parse(toMarkdown(blocks)));
}

describe("text that looks like markup", () => {
  it.each([
    "*stars* and _underscores_ and __doubles__",
    "~~tildes~~ ||pipes|| ==equals==",
    "`backticks` and ```three```",
    "[brackets](https://example.com) and [words]{red} and [^1]",
    "<@123> <#1> <t:1:R> <https://a.b>",
    "x^{2} and y_{3} and \\ backslash \\* and \\\\",
    "trailing backslash \\",
  ])("stays as typed: %j", (text) => {
    expect(shown([para(t(text))])).toBe(text);
  });

  it.each(["# heading", "## two", "> quote", ">>> all", "- item", "+ item", "* item", "1. item", "12) item", "---", "***", "___", "- - -", "::: details x", ":::", "[^1]: note", "-# small", "```js", "   - indented"])(
    "a line starting %j stays a line",
    (line) => {
      const md = toMarkdown([para(t(line))]);
      const nodes = parse(md);
      expect(nodes.map((n) => n.type), md).toEqual(["paragraph"]);
      expect(plainText(nodes)).toBe(line.replace(/^ +/, (m) => m));
    },
  );

  it("keeps a line of pipes under a table out of it", () => {
    const table: Block = { id: 1, kind: "table", wrap: null, align: [null], rows: [[[t("a")]]] };
    const md = toMarkdown([table, para(t("x | y"))]);
    const nodes = parse(md);
    expect(nodes.map((n) => n.type)).toEqual(["table", "paragraph"]);
  });

  it("keeps two lines that look like a table apart", () => {
    const md = toMarkdown([para(t("a | b")), para(t("--|--"))]);
    expect(parse(md).map((n) => n.type)).toEqual(["paragraph"]);
  });

  it("does not let a quote's first words make it a callout", () => {
    const quote = textBlock("p", [t("[!NOTE] not a callout")], "quote");
    expect(parse(toMarkdown([quote])).map((n) => n.type)).toEqual(["quote"]);
  });

  it("keeps heading words that end in hashes", () => {
    const h = textBlock("h2", [t("C# and F #")]);
    const [node] = parse(toMarkdown([h]));
    expect(node?.type === "heading" && plainText([node])).toBe("C# and F #");
  });

  it("keeps a list item that starts like a task box a plain item", () => {
    const li = textBlock("li", [t("[x] not ticked")], null, { list: { ordered: false, task: false, checked: false, indent: 0, start: null } });
    const [node] = parse(toMarkdown([li]));
    expect(node?.type === "list" && node.items[0]?.[0]?.type).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// marks next to marks
// ---------------------------------------------------------------------------

describe("marks side by side", () => {
  const cases: [string, Inline[]][] = [
    ["bold then italic", [t("a", { b: true }), t("b", { i: true })]],
    ["italic then bold", [t("a", { i: true }), t("b", { b: true })]],
    ["overlapping bold and italic", [t("a", { b: true }), t("b", { b: true, i: true }), t("c", { i: true })]],
    ["underline then italic", [t("a", { u: true }), t("b", { i: true })]],
    ["italic inside a word", [t("un"), t("believ", { i: true }), t("able")]],
    ["bold with spaces at its edges", [t("say "), t(" hi ", { b: true }), t("!")]],
    ["strike and spoiler and mark", [t("a", { s: true }), t("b", { spoiler: true }), t("c", { mark: true })]],
    ["superscript with braces", [t("x"), t("{n}", { sup: true })]],
    ["code with backticks", [t("a`b", { code: true })]],
    ["bold code", [t("x()", { code: true, b: true })]],
    ["link with brackets in its words", [t("see [1]", { link: { url: "https://a.b", noEmbed: false } })]],
    ["link with parentheses in its address", [t("wiki", { link: { url: "https://w.org/A_(b)", noEmbed: false } })]],
    ["colour then link then colour", [t("a", { color: { fg: "red", bg: null } }), t("b", { color: { fg: "red", bg: null }, link: { url: "https://a.b", noEmbed: false } }), t("c", { color: { fg: "red", bg: null } })]],
    ["text and highlight colours that change", [t("a", { color: { fg: "red", bg: "yellow" } }), t("b", { color: { fg: "red", bg: null } })]],
    ["a stray star after bold", [t("a", { b: true }), t("*")]],
    ["an equals sign after a highlight", [t("a", { mark: true }), t("=b")]],
  ];
  it.each(cases)("%s", (_name, content) => {
    const md = inlineMarkdown(content);
    const back = fromMarkdown(md).blocks[0] as TextBlock;
    const flat = (runs: Inline[]) => runs.map((r) => (r.kind === "text" ? r.text : r.raw)).join("");
    expect(flat(back.content), md).toBe(flat(content).replace(/^ +| +$/g, (m) => m));
    // every character keeps its marks
    const marksAt = (runs: Inline[]) => runs.flatMap((r) => (r.kind === "text" ? [...r.text].map((ch) => (ch.trim() ? JSON.stringify(sorted(r.marks)) : "")) : [JSON.stringify(sorted(r.marks))]));
    expect(marksAt(back.content), md).toEqual(marksAt(content));
  });
});

function sorted(m: Marks): Marks {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m).sort()) out[k] = (m as Record<string, unknown>)[k];
  return out as Marks;
}

// ---------------------------------------------------------------------------
// fuzz: any document the editor can hold comes back the same
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// "@here" is left out on purpose: it pings only after a character that is not
// part of a word, and whether that is `_` or `*` beside it is the one choice
// here that can differ from the markdown that was read.
const WORDS = ["hello", "world", "a", "*", "_", "~", "|", "=", "^", "`", "[", "]", "{", "}", "<", ">", "#", ":", "\\", "-", "1.", "(", ")", "!", "x_y", "é", "مرحبا", "👍", "https://a.b/c ", " ", "  ", ":::", "[^1]", "[x]"];
const FLAG_NAMES = ["b", "i", "u", "s", "spoiler", "mark", "sup", "sub", "code"] as const;
const COLOURS = ["red", "blue", "#ff8800", null] as const;

function randomRuns(rand: () => number, cell = false, words: string[] = WORDS): Inline[] {
  const out: Inline[] = [];
  const n = 1 + Math.floor(rand() * 5);
  for (let k = 0; k < n; k++) {
    const marks: Marks = {};
    for (const f of FLAG_NAMES) if (rand() < 0.15) marks[f] = true;
    if (rand() < 0.1) marks.link = { url: "https://example.com/" + k, noEmbed: rand() < 0.3 };
    if (rand() < 0.1) {
      const fg = COLOURS[Math.floor(rand() * COLOURS.length)] ?? null;
      const bg = rand() < 0.5 ? "yellow" : null;
      if (fg || bg) marks.color = { fg, bg };
    }
    if (rand() < 0.08) out.push({ kind: "atom", atom: "user", raw: "<@" + (100 + k) + ">", label: "@x", marks });
    else {
      let text = "";
      const count = 1 + Math.floor(rand() * 3);
      for (let w = 0; w < count; w++) text += (w ? " " : "") + words[Math.floor(rand() * words.length)];
      if (cell) text = text.replace(/\|/g, "/");
      out.push({ kind: "text", text, marks });
    }
  }
  return out;
}

function randomDoc(rand: () => number, words: string[] = WORDS): Block[] {
  const blocks: Block[] = [];
  const n = 1 + Math.floor(rand() * 8);
  let indent = -1;
  for (let k = 0; k < n; k++) {
    const roll = rand();
    const wraps: Wrap[] = [null, null, null, "quote", "note", "warning", "details"];
    const wrap = wraps[Math.floor(rand() * wraps.length)] ?? null;
    if (roll < 0.4) blocks.push(textBlock("p", randomRuns(rand, false, words), wrap));
    else if (roll < 0.5 && wrap !== "quote") blocks.push(textBlock((["h1", "h2", "h3", "h4", "h5", "h6", "subtext"] as const)[Math.floor(rand() * 7)]!, randomRuns(rand, false, words), wrap));
    else if (roll < 0.7 && wrap !== "quote") {
      indent = Math.min(MAX_INDENT, Math.max(0, indent + Math.floor(rand() * 3) - 1));
      const task = rand() < 0.3;
      blocks.push(textBlock("li", randomRuns(rand, false, words), wrap, { list: { ordered: !task && rand() < 0.5, task, checked: task && rand() < 0.5, indent, start: null } }));
      continue;
    } else if (roll < 0.8 && wrap !== "quote") blocks.push({ id: k, kind: "code", wrap, lang: rand() < 0.5 ? "js" : "", text: "const a = `x`;\n```\n::: \n| b |" });
    else if (roll < 0.9 && wrap !== "quote") {
      const cols = 1 + Math.floor(rand() * 3);
      const rows = 1 + Math.floor(rand() * 3);
      blocks.push({ id: k, kind: "table", wrap, align: Array.from({ length: cols }, (_, c) => ([null, "left", "center", "right"] as const)[c % 4]!), rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => randomRuns(rand, true, words))) });
    } else if (wrap !== "quote") blocks.push({ id: k, kind: "hr", wrap });
    else blocks.push(textBlock("p", randomRuns(rand, false, words), wrap));
    indent = -1;
  }
  return blocks;
}

/**
 * What the editor holds, without ids or blank lines: marks on each run, not
 * which of two marks with the same extent wraps the other, which looks the
 * same in a message.
 */
function held(src: string): unknown {
  return fromMarkdown(src)
    .blocks.filter((b) => !(b.kind === "p" && b.content.length === 0 && !b.wrap))
    .map((b) => ({ ...b, id: 0 }));
}

/** Every character and atom the editor holds, in order, blocks apart. */
function characters(src: string): string {
  return fromMarkdown(src)
    .blocks.map((b) => {
      if (b.kind === "code") return b.text;
      if (b.kind === "hr") return "---";
      if (b.kind === "file") return b.name;
      if (b.kind === "table") return b.rows.map((r) => r.map((c) => c.map((x) => (x.kind === "text" ? x.text : x.raw)).join("")).join("|")).join("\n");
      return b.content.map((x) => (x.kind === "text" ? x.text : x.raw)).join("");
    })
    .join("\n");
}

describe("fuzz", () => {
  it("never loses or changes a character, and settles after one pass, whatever the marker soup", () => {
    const rand = mulberry32(0xf0e11);
    for (let n = 0; n < 1000; n++) {
      const md = toMarkdown(randomDoc(rand));
      const back = roundTrip(md);
      expect(characters(back), `doc ${n}:\n${md}`).toBe(characters(md));
      expect(roundTrip(back), `doc ${n}:\n${md}`).toBe(back);
    }
  });

  it("keeps every mark on ordinary words exactly", () => {
    const rand = mulberry32(0x0dd);
    const plain = ["hello", "world", "a", "tea", "é", "مرحبا", "👍", "42", "x_y", "it's", "ok,", "yes.", "why?"];
    for (let n = 0; n < 500; n++) {
      const doc = randomDoc(rand, plain);
      const md = toMarkdown(doc);
      expect(held(roundTrip(md)), `doc ${n}:\n${md}`).toEqual(held(md));
      expect(held(md), `doc ${n}:\n${md}`).toEqual(held(toMarkdown(fromMarkdown(md).blocks)));
    }
  });

  it("never throws on marker soup", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 200; n++) {
      let src = "";
      while (src.length < 300) src += WORDS[Math.floor(rand() * WORDS.length)] + (rand() < 0.2 ? "\n" : "");
      expect(() => toMarkdown(fromMarkdown(src).blocks)).not.toThrow();
    }
  });
});

describe("a note's files", () => {
  const read = { files: true, max: 200_000 };
  const kinds = (src: string, opts?: typeof read) => fromMarkdown(src, undefined, opts).blocks.map((b) => b.kind);

  it("reads a file line as a file block and writes it back as it was", () => {
    const src = "Before\n![photo.png](nexa-file:123456789)\nAfter";
    const { blocks } = fromMarkdown(src, undefined, read);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "file", "p"]);
    expect(blocks[1]).toMatchObject({ kind: "file", file: "123456789", name: "photo.png" });
    expect(toMarkdown(blocks)).toBe(src);
  });

  it("leaves the same characters as words in a message, where there are no files", () => {
    expect(kinds("![photo.png](nexa-file:123456789)")).toEqual(["p"]);
    expect(toMarkdown(fromMarkdown("![photo.png](nexa-file:123456789)").blocks)).toContain("nexa-file:123456789");
  });

  it("only takes a line that is a file and nothing else", () => {
    expect(kinds("see ![a.png](nexa-file:1) here", read)).toEqual(["p"]);
    expect(kinds("![a.png](https://example.com/a.png)", read)).toEqual(["p"]);
    expect(kinds("![a.png](nexa-file:not an id)", read)).toEqual(["p"]);
    expect(kinds("```\n![a.png](nexa-file:1)\n```", read)).toEqual(["code"]);
  });

  it("keeps a file inside a callout and a folded section, and several in a row", () => {
    for (const src of ["> [!NOTE]\n> words\n> ![a.png](nexa-file:1)", "::: details Summary\n![a.png](nexa-file:1)\n:::", "![a.png](nexa-file:1)\n![b.pdf](nexa-file:2)\n\n![c.mp4](nexa-file:3)"]) {
      const { blocks } = fromMarkdown(src, undefined, read);
      expect(blocks.some((b) => b.kind === "file"), src).toBe(true);
      expect(toMarkdown(blocks), src).toBe(src);
    }
  });

  it("keeps a file's name out of the way of the syntax around it", () => {
    const { blocks } = fromMarkdown("x", undefined, read);
    const out = toMarkdown([...blocks, { id: 99, kind: "file", file: "7", name: "a [draft]\n(final).png", wrap: null }]);
    expect(out).toBe("x\n![a draft (final).png](nexa-file:7)");
    expect(fromMarkdown(out, undefined, read).blocks[1]).toMatchObject({ kind: "file", file: "7", name: "a draft (final).png" });
  });

  it("reads a note far longer than a message", () => {
    const long = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    expect(fromMarkdown(long).blocks.length).toBeLessThan(3000);
    expect(fromMarkdown(long, undefined, read).blocks.length).toBe(3000);
  });
});
