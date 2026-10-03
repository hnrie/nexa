// Writes android/app/src/test/resources/web-search-vectors.json.gz: what the
// web's own search code (src/search, lib/search.ts, components/search/suggest.ts)
// makes of a corpus, for the Android port's tests to match exactly
// (fish.nexa.search.*).
//
// vite-node can only load files under web/, so this is copied there to run:
//
//   cp android/tools/search_vectors.ts web/search-vectors.gen.ts
//   (cd web && TZ=America/New_York npx vite-node search-vectors.gen.ts)
//   rm web/search-vectors.gen.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fold, foldWithMap, tokenize, termTokens, excerptAround, highlightRuns } from "@/search/text";
import { dateRange, parseQuery, resolveQuery, matches, needlesOf, withoutToken, filterValue, isEmptyQuery, type SearchCtx } from "@/lib/search";
import { searchableText, linksIn, mediaOf, filesOf, linksOf, hasKinds, type SearchDoc } from "@/search/doc";
import { SearchEngine, TABS, type Sort } from "@/search/engine";
import { suggest, partialAt, replacePiece, channelValue } from "@/components/search/suggest";
import type { Names } from "@/components/search/scope";
import type { Channel, PublicUser } from "@/api/types";

const OUT = join(process.cwd(), "../android/app/src/test/resources/web-search-vectors.json.gz");

// ---- words ----

const TEXTS = [
  "",
  "hello world",
  "Hello, World! HELLO again",
  "café crème brûlée",
  "CAFÉ au lait",
  "naïve façade coöperate",
  "Ελληνικά: Καλημέρα, ΣΟΦΟΣ σοφός",
  "Привет, мир! Йогурт и ёлка",
  "Straße und Fußball",
  "ﬁne ﬂour ﬀ",
  "ＡＢＣ　ｆｕｌｌ　ｗｉｄｔｈ １２３",
  "مَرْحَبًا بِالعَالَمِ الكتاب الكِتَابُ كتاب",
  "ـــمرحـــبا",
  "हिन्दी में लिखा है किताब",
  "日本語のテキストです。がぎぐ",
  "中文搜索测试 一个字",
  "한국어 텍스트 검색",
  "emoji 😀 party 🎉🎉 fire🔥",
  "İstanbul ılık İYİ",
  "é à ỗ combining",
  "́leading mark",
  "tabs\tand\nnewlines nbsp",
  "need needle needs kneed",
  "under_score dash-word dot.word",
  "https://example.com/page?x=1, and http://foo.bar/baz.",
  "ß at end ß",
  "ǅemal ǈubav titlecase",
  "Ⅻ roman numeral ½ fraction ²",
  "x".repeat(10) + " café " + "y".repeat(10),
];

const LONG = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8) + "The needle is here in the middle. " + "Sed do eiusmod tempor incididunt. ".repeat(8),
  "Café ".repeat(70) + "fin",
  "word ".repeat(100) + "Straße target " + "more ".repeat(40),
  "short start match then " + "padding text ".repeat(40),
];

const NEEDLE_SETS = [[], ["needle"], ["cafe"], ["strasse"], ["match"], ["fin"], ["ss"], ["need", "needle"], ["xyz"], ["e"], ["word"]];

// ---- queries ----

const QUERIES = [
  "",
  "   ",
  "hello",
  "Hello World",
  '"exact phrase" more',
  '"unclosed phrase',
  '""',
  '"  spaced  "',
  "-exclude this",
  "-",
  "from:bob",
  "FROM:Bob",
  "from:@bob",
  "from:me",
  'from:"Ann Lee" words',
  'From:"Bob',
  "from:",
  "in:general",
  "in:#general",
  "in:@bob",
  'in:"weekend plans"',
  "mentions:alice",
  "mentions:everyone",
  "mentions:here",
  "mentions:@carol",
  "has:image",
  "has:IMAGE has:link has:image",
  "has:unicorn",
  "has:",
  "pinned:yes",
  "pinned:no",
  "pinned:maybe",
  "pinned:TRUE",
  "before:2026-01-31",
  "after:2026-01-31",
  "during:2026-01",
  "during:2026",
  "before:2026-02-30",
  "before:2026-13",
  "before:0025",
  "after:2026-01-31 before:2026-01-31",
  "during:2025 during:2026",
  "before:2026-1-5",
  "before: 2026",
  "notakey:value",
  "-from:bob",
  "a:b:c",
  "xfrom:\"bob\"",
  'from:"bob"in:general',
  '"phrase"from:"x"',
  "word nbsp　ideographic",
  "café CAFÉ",
  "日本語 テキスト",
  "😀 party",
  "from:bob in:general has:file before:2026-06 pinned:yes -nope \"a b\" c",
  "in:general in:random",
  "from:ann from:2000",
  "from:99999",
];

// ---- people and conversations ----

const users: Record<string, PublicUser> = {};
function user(id: string, username: string, display: string): void {
  users[id] = { id, username, display_name: display } as PublicUser;
}
user("2000", "alice", "Alice");
user("2001", "bob", "Bob Builder");
user("2002", "carol", "Carol");
user("2003", "ann", "Ann Lee");
user("2004", "ännchen", "Ännchen Müller");
user("2005", "dave_s", "Dave S.");

const ctx: SearchCtx = {
  users,
  nicknames: { "2001": ["bobby"], "2003": ["annie", "the boss"] },
  channelNames: {
    "1000": ["general"],
    "1001": ["random"],
    "1002": ["bob builder", "bob"],
    "1003": ["weekend plans"],
    "1004": ["café talk"],
  },
  meId: "2000",
};

function ch(id: string, type: string, name: string, extra: Partial<Channel> = {}): Channel {
  return { id, type, name, server_id: null, parent_id: null, recipient_ids: [], last_message_id: null, ...extra } as unknown as Channel;
}
const channels: Channel[] = [
  ch("1000", "text", "general", { server_id: "3000" } as Partial<Channel>),
  ch("1001", "text", "random", { server_id: "3000" } as Partial<Channel>),
  ch("1002", "dm", "", { recipient_ids: ["2000", "2001"] } as Partial<Channel>),
  ch("1003", "group_dm", "weekend plans", { recipient_ids: ["2000", "2002", "2003"] } as Partial<Channel>),
  ch("1004", "text", "café talk", { server_id: "3001" } as Partial<Channel>),
];

const names: Names = {
  users,
  meId: "2000",
  person: (id) => (id === "2001" ? "bobby" : (users[id]?.display_name ?? "Unknown")),
  channel: (c) => (c.server_id ? `#${c.name}` : c.type === "dm" ? (users[c.recipient_ids.find((x) => x !== "2000") ?? ""]?.display_name ?? "") : c.name),
  serverName: (id) => (id === "3000" ? "Alice's server" : id === "3001" ? "Cafe Club" : null),
  ctx,
};

// ---- a corpus of messages, made the same way every run ----

let seed = 42;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

const WORDS = ["hello", "world", "café", "needle", "plans", "weekend", "pizza", "Straße", "日本語", "テキスト", "中文", "bob", "meeting", "notes", "release", "build", "the", "a", "and", "Ελληνικά", "мир", "😀", "budget", "draft", "photos", "trip", "kitchen", "launch"];
const ATT = [
  { blob_id: "5001", name: "photo.jpg", type: "image/jpeg", size: 1200, key: "k" },
  { blob_id: "5002", name: "clip.mp4", type: "video/mp4", size: 99000, key: "k" },
  { blob_id: "5003", name: "song.mp3", type: "audio/mpeg", size: 5000, key: "k" },
  { blob_id: "5004", name: "notes-for-the-meeting.txt", type: "text/plain", size: 300, key: "k" },
  { blob_id: "5005", name: "Budget.PDF", type: "application/pdf", size: 4000, key: "k" },
  { blob_id: "5006", name: "IMG_0001.PNG", type: "IMAGE/PNG", size: 2000, key: "k" },
];
const EMB = [
  { url: "https://example.com/article", type: "article", title: "An Article Title", site: "Example" },
  { url: "https://media.example/cat.gif", type: "gif", image: "https://media.example/cat.gif" },
  { url: "https://video.example/v", type: "video", title: "A Video", image: "https://video.example/thumb.jpg" },
  { url: "https://img.example/p.png", type: "image" },
  { url: "https://news.example/story", title: "Breaking café news", site: "News Site" },
];

const docs: SearchDoc[] = [];
const BASE = Date.UTC(2025, 11, 20);
for (let i = 0; i < 320; i++) {
  const n = 1 + Math.floor(rnd() * 8);
  const words: string[] = [];
  for (let k = 0; k < n; k++) words.push(pick(WORDS));
  if (rnd() < 0.12) words.push(pick(["https://example.com/article", "http://foo.bar/x.", "see https://img.example/p.png", "https://news.example/story"]));
  const d: SearchDoc = {
    id: String(100000 + i * 7 + Math.floor(rnd() * 5)),
    c: pick(["1000", "1001", "1002", "1003", "1004"]),
    a: pick(["2000", "2001", "2002", "2003", "2004", "2005"]),
    ts: BASE + i * 3_600_000 * 5 + Math.floor(rnd() * 1000),
    ed: rnd() < 0.1 ? BASE + i * 1000 : null,
    t: words.join(" "),
    fl: rnd() < 0.08 ? 1 : 0,
  };
  if (rnd() < 0.15) d.mn = [pick(["2000", "2001", "2002"])];
  if (rnd() < 0.05) d.ev = true;
  if (rnd() < 0.2) d.att = [pick(ATT), ...(rnd() < 0.3 ? [pick(ATT)] : [])].map((a, j) => ({ ...a, blob_id: `${a.blob_id}${i}${j}` }));
  if (rnd() < 0.15) d.emb = [pick(EMB)];
  if (rnd() < 0.04) d.st = { id: "77", name: pick(["party parrot", "thumbs"]) } as SearchDoc["st"];
  if (rnd() < 0.04) {
    d.hn = "CI Bot";
    d.hx = "build passed release notes";
  }
  docs.push(d);
}
// ids must be unique
const seen = new Set<string>();
for (const d of docs) {
  while (seen.has(d.id)) d.id = String(Number(d.id) + 1);
  seen.add(d.id);
}

// ---- run everything ----

const out: Record<string, unknown> = {};

out.fold = [...TEXTS, ...LONG].map((t) => ({ text: t, folded: fold(t) }));
out.foldWithMap = TEXTS.map((t) => ({ text: t, ...foldWithMap(t) }));
out.tokenize = TEXTS.map((t) => ({ folded: fold(t), tokens: tokenize(fold(t)), terms: termTokens(fold(t)) }));
out.excerpt = LONG.concat(TEXTS).flatMap((t) => NEEDLE_SETS.map((n) => ({ text: t, needles: n, out: excerptAround(t, n) })));
out.excerptMax = LONG.flatMap((t) => [40, 80, 200].map((max) => ({ text: t, needles: ["needle", "target", "fin"], max, out: excerptAround(t, ["needle", "target", "fin"], max) })));
out.highlight = [...TEXTS, ...LONG.slice(0, 2)].flatMap((t) => NEEDLE_SETS.map((n) => ({ text: t, needles: n, runs: highlightRuns(t, n) })));

const DATES = ["2026", "2026-01", "2026-1", "2026-01-31", "2026-02-29", "2024-02-29", "2026-02-30", "2026-13", "2026-00", "0025", "0100", "1999-12-31", " 2026-03-08 ", "2026-11-01", "abcd", "2026-1-1", "20266", "2026-01-01-01"];
out.dateRange = DATES.map((v) => ({ v, range: dateRange(v) }));

out.parse = QUERIES.map((q) => {
  const p = parseQuery(q);
  return { q, parsed: p, empty: isEmptyQuery(p), needles: needlesOf(p), resolved: resolveQuery(p, ctx) };
});

out.withoutToken = QUERIES.flatMap((q) => parseQuery(q).tokens.map((tok) => ({ q, start: tok.start, end: tok.end, out: withoutToken(q, tok) })));
out.filterValue = ["general", "weekend plans", 'say "hi"', "a b", ""].map((v) => ({ v, out: filterValue(v) }));

out.docs = docs;
out.docFacts = docs.map((d) => ({
  id: d.id,
  searchable: searchableText(d),
  links: linksIn(d.t),
  media: mediaOf(d).map((m) => (m.kind === "file" ? `file:${m.att.blob_id}` : `link:${m.embed.url}`)),
  files: filesOf(d).map((a) => a.blob_id),
  linkItems: linksOf(d).map((l) => `${l.url}|${l.preview ? "p" : ""}`),
  has: [...hasKinds(d)].sort(),
}));

const LINK_TEXTS = ["https://example.com/page?x=1, and http://foo.bar/baz.", "HTTPS://UPPER.EXAMPLE/PATH!", "http://a.b (http://c.d/e) [https://x.y/z]", "no links here http:// nor https://", "dup https://dup.example/x https://dup.example/x", "https://short.c", "trail https://example.com/a?b=c***", "quote 'https://q.example/p' and \"https://q2.example/p\"", "https://example.com/ after"];
out.linksIn = LINK_TEXTS.map((t) => ({ t, links: linksIn(t) }));

// matching each query against each doc, by id
const resolvedQueries = QUERIES.map((q) => resolveQuery(parseQuery(q), ctx));
out.matches = resolvedQueries.map((r, i) => ({ q: QUERIES[i], ids: docs.filter((d) => matches(d, r)).map((d) => d.id) }));

// the engine
const engine = new SearchEngine();
for (const d of docs) engine.upsert(d);
// a few changes: an edit, a removal, a re-add
engine.upsert({ ...docs[3]!, t: docs[3]!.t + " edited", ed: 1 });
engine.remove(docs[5]!.id);
engine.upsert({ ...docs[7]!, fl: 1 });
const ENGINE_QUERIES = ["hello", "café", "cafe", "need", '"hello world"', "photos -trip", "日本", "テキ", "中文", "😀", "from:bob", "from:me has:file", "has:image", "has:link", "has:video has:image", "mentions:everyone", "mentions:bob", "pinned:yes", "in:general hello", "in:random", "before:2026-01-01", "after:2026-02-01", "during:2026-01", "release", "build", "notes", "budget", "the", "straße", "strasse", "ελληνικα", "мир", "edited", "zzzz", "from:nobody", "in:nowhere", "a", "photo", "article", "breaking", "party"];
const SORTS: Sort[] = ["newest", "oldest", "relevance"];
out.engine = ENGINE_QUERIES.flatMap((q) => {
  const r = resolveQuery(parseQuery(q), ctx);
  return TABS.flatMap((tab) =>
    SORTS.map((sort) => {
      const res = engine.query({ query: r, scope: null, tab, sort, offset: 0, limit: 25 });
      return { q, tab, sort, scope: null, counts: res.counts, total: res.total, ids: res.docs.map((d) => d.id) };
    }),
  );
});
out.engineScoped = ["hello", "", "has:file", "from:bob", "café"].flatMap((q) => {
  const r = resolveQuery(parseQuery(q), ctx);
  return [["1000"], ["1002", "1003"], [], ["9999"]].map((scope) => {
    const res = engine.query({ query: r, scope, hide: ["2003"], tab: "messages", sort: "newest", offset: 5, limit: 10 });
    return { q, scope, hide: ["2003"], counts: res.counts, total: res.total, ids: res.docs.map((d) => d.id) };
  });
});
out.engineSize = engine.size;
out.engineEdits = { edited: docs[3]!.id, removed: docs[5]!.id, pinned: docs[7]!.id };

// suggestions
const NOW = Date.UTC(2026, 9, 3, 15, 0, 0);
const SUGGEST = [
  { raw: "", caret: 0 },
  { raw: "fr", caret: 2 },
  { raw: "from:", caret: 5 },
  { raw: "from:b", caret: 6 },
  { raw: "from:ann", caret: 8 },
  { raw: "from:ä", caret: 6 },
  { raw: "mentions:", caret: 9 },
  { raw: "mentions:ev", caret: 11 },
  { raw: "in:", caret: 3 },
  { raw: "in:gen", caret: 6 },
  { raw: "in:bob", caret: 6 },
  { raw: "in:caf", caret: 6 },
  { raw: "has:", caret: 4 },
  { raw: "has:i", caret: 5 },
  { raw: "pinned:", caret: 7 },
  { raw: "pinned:n", caret: 8 },
  { raw: "before:", caret: 7 },
  { raw: "before:2026-1", caret: 13 },
  { raw: "during:20", caret: 9 },
  { raw: "hello bo", caret: 8 },
  { raw: "hello bo world", caret: 8 },
  { raw: "an", caret: 2 },
  { raw: "we", caret: 2 },
  { raw: "h", caret: 1 },
  { raw: '"phrase" fr', caret: 11 },
  { raw: '"phrase" fr', caret: 3 },
  { raw: "-ex", caret: 3 },
  { raw: "hello ", caret: 6 },
  { raw: "from:bob in:", caret: 12 },
  { raw: "from:bob in:", caret: 4 },
];
out.suggest = SUGGEST.map((s) => ({
  ...s,
  partial: partialAt(s.raw, s.caret),
  groups: suggest({ raw: s.raw, caret: s.caret, names, channels, nearby: ["2001"], recent: ["old search", "from:bob hello", "café"], now: NOW }).map((g) => ({
    kind: g.kind,
    items: g.items.map((it) => ({ id: it.id, kind: it.kind, text: it.text, caret: it.caret, key: it.key ?? null, value: it.value ?? null, userId: it.userId ?? null, channel: it.channel?.id ?? null, has: it.has ?? null, date: it.date ?? null, recent: it.recent ?? null })),
  })),
}));
out.replacePiece = [
  { raw: "hello fr world", start: 6, end: 8, insert: "from:", finished: false },
  { raw: "hello fr world", start: 6, end: 8, insert: "from:bob", finished: true },
  { raw: "fr", start: 0, end: 2, insert: "from:bob", finished: true },
  { raw: "fr   x", start: 0, end: 2, insert: "in:general", finished: true },
].map((x) => ({ ...x, out: replacePiece(x.raw, x, x.insert, x.finished) }));
out.channelValue = channels.map((c) => ({ id: c.id, value: channelValue(c, names) }));

writeFileSync(OUT, gzipSync(JSON.stringify(out)));
console.log("wrote", OUT);
