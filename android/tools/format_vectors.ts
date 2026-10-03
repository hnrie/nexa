// Writes android/app/src/test/resources/web-format-vectors.json.gz: what the
// web's formatting editor (components/composer/format) makes of the markdown
// corpus, of random runs, and of random edits, for fish.nexa.markdown.format
// to match. Run markdown_vectors.ts first (its corpus is read from its output).
//
//   cp android/tools/format_vectors.ts web/fmt-vectors.gen.ts
//   (cd web && TZ=Asia/Kolkata npx vite-node fmt-vectors.gen.ts)
//   rm web/fmt-vectors.gen.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { fromMarkdown, toMarkdown, inlineMarkdown, inlineFromMarkdown, misleads } from "@/components/composer/format/markdown";
import * as M from "@/components/composer/format/model";
import type { Block, Inline, Marks, Pos, Sel } from "@/components/composer/format/model";
import { ensureShortcodes, onShortcodesReady, shortcodesReady } from "@/lib/shortcodes";

const RES = join(process.cwd(), "../android/app/src/test/resources");
const corpusAll = (JSON.parse(gunzipSync(readFileSync(join(RES, "web-markdown-vectors.json.gz"))).toString()) as { parse: { src: string }[] }).parse.map((p) => p.src);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(777);
const int = (n: number) => Math.floor(rand() * n);
const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;

const names = {
  users: { "123": { display_name: "Ann", username: "ann" }, "456": { display_name: "", username: "bob" } },
  channels: { "789": { name: "general" } },
  roles: { "10": { name: "Mods", color: 0 } },
  emojiUrl: (id: string, animated: boolean, css?: number) => `/e/${id}?a=${animated}&s=${css}`,
};

/** Blocks as JSON without their ids, and with times' words left out (they depend on the clock). */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (k === "id") return undefined;
      if (v && typeof v === "object" && (v as { atom?: string }).atom === "time") return { ...(v as object), label: "" };
      return v;
    }),
  );
}

// --- random runs --------------------------------------------------------------
const WORDS = ["a", "word", " ", "  ", "x y", "Hello", "_", "*", "**", "~", "~~", "|", "||", "=", "==", "^", "^{", "{", "}", "[", "]", "(", ")", "<", ">", "`", "\\", ":", ":smile:", ":nope:", "#", "-", "1.", "!", "https://a.example/x_(y)", "http://b.example.", "www.c.example", "é", "😀", "日本", "\n", "\t", "snake_case", "a==b", "<@1>", "[^1]", ":+1:"];
const URLS = ["https://a.example", "https://b.example/p?q=(1)", "https://c.example/(x", "https://d.example/a b", "https://bank.example", "https://e.example/>"];
const COLORS = ["red", "#00ff00", null] as const;
const ATOMS: Inline[] = [
  { kind: "atom", atom: "user", raw: "<@123>", label: "@Ann", marks: {} },
  { kind: "atom", atom: "channel", raw: "<#789>", label: "#general", marks: {} },
  { kind: "atom", atom: "emoji", raw: "<:blob:5>", label: ":blob:", marks: {} },
  { kind: "atom", atom: "time", raw: "<t:1700000000:R>", label: "", marks: {} },
  { kind: "atom", atom: "fnref", raw: "[^1]", label: "1", marks: {} },
  { kind: "atom", atom: "link", raw: "<https://a.example>", label: "https://a.example", marks: {} },
];

function randMarks(): Marks {
  const m: Marks = {};
  for (const f of ["b", "i", "u", "s", "spoiler", "mark", "sup", "sub"] as const) if (rand() < 0.22) m[f] = true;
  if (rand() < 0.08) m.code = true;
  if (rand() < 0.15) m.link = { url: pick(URLS), noEmbed: rand() < 0.3 };
  if (rand() < 0.12) {
    const fg = pick(COLORS);
    const bg = pick(COLORS);
    if (fg || bg) m.color = { fg, bg };
  }
  return m;
}

function randRuns(): Inline[] {
  const out: Inline[] = [];
  const n = 1 + int(6);
  let marks = randMarks();
  for (let k = 0; k < n; k++) {
    if (rand() < 0.5) marks = randMarks();
    if (rand() < 0.12) out.push({ ...pick(ATOMS), marks });
    else {
      let text = "";
      for (let j = 1 + int(4); j > 0; j--) text += pick(WORDS);
      out.push({ kind: "text", text, marks });
    }
  }
  return out;
}

// --- random edits ------------------------------------------------------------
function randPos(blocks: Block[]): Pos {
  const b = int(blocks.length);
  const block = blocks[b]!;
  if (block.kind === "table") {
    const cell: [number, number] = [int(block.rows.length), int(block.align.length)];
    return { b, cell, o: int(M.sizeAt(blocks, { b, cell, o: 0 }) + 1) };
  }
  return { b, o: int(M.sizeAt(blocks, { b, o: 0 }) + 1) };
}

function randSel(blocks: Block[]): Sel {
  const a = randPos(blocks);
  if (rand() < 0.35) return { anchor: a, focus: a };
  if (rand() < 0.5) return { anchor: a, focus: { ...a, o: int(M.sizeAt(blocks, a) + 1) } };
  return { anchor: a, focus: randPos(blocks) };
}

type Op = Record<string, unknown> & { op: string };

function randOp(blocks: Block[]): Op {
  const kinds = ["insert", "split", "joinBack", "joinFwd", "delete", "mark", "color", "link", "kind", "list", "indent", "check", "wrap", "code", "block", "table", "clear"];
  const op = pick(kinds);
  switch (op) {
    case "insert":
      return { op, at: randPos(blocks), runs: rand() < 0.5 ? [{ kind: "text", text: pick(WORDS), marks: rand() < 0.3 ? randMarks() : {} }] : randRuns() };
    case "split":
      return { op, at: randPos(blocks) };
    case "joinBack":
    case "joinFwd":
    case "check":
      return { op, index: int(blocks.length) };
    case "delete":
    case "code":
    case "clear":
      return { op, sel: randSel(blocks) };
    case "mark":
      return { op, sel: randSel(blocks), flag: pick(["b", "i", "u", "s", "spoiler", "mark", "sup", "sub", "code"]), on: rand() < 0.7 };
    case "color":
      return { op, sel: randSel(blocks), part: pick(["fg", "bg"]), value: pick(["red", "blue", "#123456", null]) };
    case "link":
      return { op, sel: randSel(blocks), link: rand() < 0.7 ? { url: pick(URLS), noEmbed: rand() < 0.3 } : null };
    case "kind":
      return { op, sel: randSel(blocks), kind: pick(["p", "h1", "h2", "h3", "h4", "h5", "h6", "subtext"]) };
    case "list":
      return { op, sel: randSel(blocks), type: pick(["bullet", "ordered", "task"]) };
    case "indent":
      return { op, sel: randSel(blocks), delta: rand() < 0.6 ? 1 : -1 };
    case "wrap":
      return { op, sel: randSel(blocks), wrap: pick(["quote", "note", "tip", "important", "warning", "caution", "details"]) };
    case "block":
      return { op, sel: randSel(blocks), block: pick(["hr", "table", "code"]) };
    default: {
      const tables = blocks.map((b, i) => (b.kind === "table" ? i : -1)).filter((i) => i >= 0);
      if (tables.length === 0) return { op: "split", at: randPos(blocks) };
      const index = pick(tables);
      const t = blocks[index] as M.TableBlock;
      const kind = pick(["addRow", "addCol", "delRow", "delCol", "align"]);
      const tableOp = kind === "align" ? { kind, col: int(t.align.length), align: pick(["left", "center", "right", null]) } : { kind, at: int(kind.endsWith("Row") ? t.rows.length + 1 : t.align.length + 1) };
      return { op: "table", index, tableOp };
    }
  }
}

function apply(blocks: Block[], sel: Sel, o: Op): { blocks: Block[]; sel: Sel } {
  switch (o.op) {
    case "insert":
      return M.insertAt(blocks, o["at"] as Pos, o["runs"] as Inline[]);
    case "split":
      return M.splitAt(blocks, o["at"] as Pos);
    case "joinBack":
      return M.joinBackward(blocks, o["index"] as number);
    case "joinFwd":
      return M.joinForward(blocks, o["index"] as number);
    case "check":
      return { blocks: M.toggleChecked(blocks, o["index"] as number), sel };
    case "delete":
      return M.deleteRange(blocks, o["sel"] as Sel);
    case "mark":
      return { blocks: M.mapSelection(blocks, o["sel"] as Sel, (m) => M.withMark(m, o["flag"] as M.Flag, o["on"] as boolean)), sel: o["sel"] as Sel };
    case "color":
      return { blocks: M.mapSelection(blocks, o["sel"] as Sel, (m) => M.withColor(m, o["part"] as "fg" | "bg", o["value"] as string | null)), sel: o["sel"] as Sel };
    case "link":
      return { blocks: M.mapSelection(blocks, o["sel"] as Sel, (m) => M.withLink(m, o["link"] as Marks["link"] | null)), sel: o["sel"] as Sel };
    case "kind":
      return { blocks: M.setKind(blocks, o["sel"] as Sel, o["kind"] as "p"), sel: o["sel"] as Sel };
    case "list":
      return { blocks: M.toggleList(blocks, o["sel"] as Sel, o["type"] as "bullet"), sel: o["sel"] as Sel };
    case "indent":
      return { blocks: M.indentBy(blocks, o["sel"] as Sel, o["delta"] as 1 | -1), sel: o["sel"] as Sel };
    case "wrap":
      return M.toggleWrap(blocks, o["sel"] as Sel, o["wrap"] as "quote");
    case "code":
      return M.toggleCode(blocks, o["sel"] as Sel);
    case "block": {
      const kind = o["block"] as string;
      const block: Block = kind === "hr" ? { id: M.newId(), kind: "hr", wrap: null } : kind === "table" ? M.emptyTable(2, 2) : { id: M.newId(), kind: "code", lang: "", text: "", wrap: null };
      return M.insertBlock(blocks, o["sel"] as Sel, block);
    }
    case "table":
      return { blocks: M.editTable(blocks, o["index"] as number, o["tableOp"] as never), sel };
    case "clear":
      return { blocks: M.clearFormatting(blocks, o["sel"] as Sel), sel: o["sel"] as Sel };
    default:
      return { blocks, sel };
  }
}

async function main(): Promise<void> {
  if (!shortcodesReady()) {
    await new Promise<void>((resolve) => {
      onShortcodesReady(() => resolve());
      ensureShortcodes();
    });
  }
  // the corpus without its giant inputs, which say nothing new here
  const corpus = corpusAll.filter((s) => s.length < 2000);

  const loads = corpus.filter((_, i) => i % 2 === 0).map((src) => {
    const loaded = fromMarkdown(src, names);
    return { src, blocks: plain(loaded.blocks), simplified: loaded.simplified, md: toMarkdown(loaded.blocks) };
  });
  const files = corpus.filter((_, i) => i % 7 === 0).map((src) => {
    const loaded = fromMarkdown(src, names, { files: true, max: 20000 });
    return { src, blocks: plain(loaded.blocks), md: toMarkdown(loaded.blocks) };
  });
  const lines = corpus.filter((_, i) => i % 5 === 0).map((src) => ({ src, runs: plain(inlineFromMarkdown(src.split("\n")[0] ?? "", names)) }));

  const runs: unknown[] = [];
  for (let k = 0; k < 3000; k++) {
    const r = randRuns();
    runs.push({ runs: plain(r), md: inlineMarkdown(r), cell: inlineMarkdown(r, { cell: true }), misleads: misleads(r) });
  }

  const edits: unknown[] = [];
  for (const src of corpus.filter((_, i) => i % 6 === 0)) {
    let blocks = fromMarkdown(src, names).blocks;
    let sel: Sel = M.caret(0, 0);
    const steps: unknown[] = [];
    for (let s = 0; s < 6; s++) {
      const o = randOp(blocks);
      let next: { blocks: Block[]; sel: Sel };
      try {
        next = apply(blocks, sel, o);
      } catch {
        continue;
      }
      blocks = next.blocks;
      sel = next.sel;
      const probe = randSel(blocks);
      const tb = blocks.findIndex((b) => M.isText(b));
      const text = tb >= 0 ? (blocks[tb] as M.TextBlock) : null;
      const at = text ? int(M.inlineLength(text.content) + 1) : 0;
      steps.push({
        op: plain(o),
        blocks: plain(blocks),
        sel,
        md: toMarkdown(blocks),
        probe: { sel: probe, has: M.selectionHas(blocks, probe, (m) => !!m.b), runs: plain(M.selectedRuns(blocks, probe)) },
        marksAt: text ? { b: tb, o: at, marks: M.marksAt(text.content, at), link: M.linkAround(text.content, at) } : null,
      });
    }
    edits.push({ src, steps });
  }

  writeFileSync(join(RES, "web-format-vectors.json.gz"), gzipSync(JSON.stringify({ loads, files, lines, runs, edits }), { level: 9 }));
  console.log("format vectors:", loads.length, "documents,", runs.length, "run lists,", edits.length, "edit sequences");
}

void main();
