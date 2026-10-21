// Writes android/app/src/test/resources/web-hook-vectors.json.gz: what the
// web's lib/webhookMessage.ts makes of webhook messages, good and mangled,
// for fish.nexa.ui.markdown.Webhook to match.
//
//   cp android/tools/hook_vectors.ts web/hook-vectors.gen.ts
//   (cd web && TZ=Asia/Kolkata npx vite-node hook-vectors.gen.ts)
//   rm web/hook-vectors.gen.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { sanitizeHook, hookText, listedAttachments, mediaAttachment, sameHookSender } from "@/lib/webhookMessage";

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
const rand = mulberry32(4242);
const int = (n: number) => Math.floor(rand() * n);
const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;

const media = (n: number) => ({ url: `https://cdn.example/${n}.png`, proxy_url: `/media/proxy/1999999999-sig/k${n}/p.png`, width: 640, height: 480, content_type: "image/png", description: "a picture" });

const base = {
  name: "Deploy Bot",
  avatar_id: "123456789012345678",
  avatar_proxy_url: "/media/proxy/1999999999-a/av/x.png",
  avatar_url: "https://cdn.example/avatar.png",
  content: "Build **passed** for <#789> by <@123>",
  tts: false,
  embeds: [
    {
      type: "rich",
      title: "Release 1.2",
      description: "Notes go *here*",
      url: "https://example.com/r/1.2",
      timestamp: "2026-10-03T12:00:00Z",
      color: 0x5865f2,
      author: { name: "CI", url: "https://ci.example", proxy_icon_url: "/media/proxy/1999999999-b/ic/i.png", icon_blob_id: "42" },
      footer: { text: "footer words", proxy_icon_url: "/media/proxy/1999999999-c/f/f.png", icon_blob_id: "43" },
      image: media(1),
      thumbnail: { url: "attachment://t.png", blob_id: "777", attachment_id: "778", width: 0, height: 10 },
      fields: [
        { name: "A", value: "1", inline: true },
        { name: "B", value: "2" },
        { name: 5, value: "bad" },
      ],
    },
  ],
  components: [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: "Open", url: "https://example.com", emoji: { name: "🚀" } },
        { type: 2, style: 1, label: "Disabled".repeat(20), disabled: true, emoji: { id: "99", name: "blob", animated: true } },
      ],
    },
    { type: 9, components: [{ type: 10, content: "section words" }], accessory: { type: 11, media: media(2), description: "thumb" } },
    { type: 12, items: [{ media: media(3), description: "one", spoiler: true }, { media: { url: "x" } }, { media: media(4) }] },
    { type: 13, file: { url: "attachment://f.zip", blob_id: "555" }, name: "f.zip", size: 1234, spoiler: false },
    { type: 14, divider: false, spacing: 2 },
    { type: 17, accent_color: 0xff0000, components: [{ type: 10, content: "inside a container" }] },
  ],
  poll: {
    question: { text: "Lunch?" },
    answers: [
      { answer_id: 1, poll_media: { text: "Pizza", emoji: { name: "🍕" } } },
      { answer_id: 2, poll_media: { text: "Salad" } },
      { answer_id: "3", poll_media: { text: "bad id" } },
    ],
    expiry: "2026-10-04T12:00:00.000Z",
    allow_multiselect: true,
  },
  attachments: [
    { id: "555", blob_id: "555", filename: "f.zip", size: 1234, content_type: "application/zip", inline: true },
    { id: "777", blob_id: "777", filename: "t.png", size: 99, width: 10, height: 20, spoiler: true, description: "alt words", duration_secs: 0 },
    { id: "888", blob_id: "888", filename: "song.mp3", size: 5000, content_type: "audio/mpeg", duration_secs: 12.5, title: "Song" },
  ],
  link_embeds: [
    { url: "https://example.com/r/1.2", type: "link", title: "Release", image: "/media/proxy/1999999999-d/i/i.png", image_w: 100, image_h: 50 },
    { type: "link", title: "no url" },
    { url: "javascript:alert(1)", title: "bad" },
  ],
  source: "github",
};

// an app's message: what someone used, buttons that do something, select menus, stickers
const app = {
  name: "Lab Bot",
  application_id: "223456789012345678",
  content: "Pick one",
  interaction: {
    id: "323456789012345678",
    type: 2,
    user_id: "123",
    name: "config set",
    command_type: 1,
    target_user_id: "5",
    target_message_id: "x",
    original_response_message_id: "8",
    trigger: { id: "4", type: 3, user_id: "123", trigger: { id: "6", type: 2, user_id: "7" } },
  },
  stickers: [
    { id: "11", name: "wave".repeat(10), blob_id: "12", format: "png" },
    { id: "13", blob_id: "14", format: "svg" },
    { id: "x", blob_id: "15" },
    { id: "16", blob_id: "17", format: "webm" },
  ],
  components: [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Press", custom_id: "press" },
        { type: 2, style: 3, label: "Yes", custom_id: "y".repeat(120), emoji: { name: "✅" } },
        { type: 2, style: 4, label: "No", custom_id: "no", disabled: true },
        { type: 2, style: 2, label: "Empty id", custom_id: "" },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: "pick",
          placeholder: "Choose".repeat(30),
          min_values: 1,
          max_values: 2.7,
          options: [
            { label: "A", value: "a", description: "first", emoji: { name: "🅰" }, default: true },
            { label: "B".repeat(120), value: "b", description: "", default: "yes" },
            { label: 5, value: "bad" },
            { label: "", value: "" },
          ],
        },
      ],
    },
    { type: 1, components: [{ type: 5, custom_id: "who", default_values: [{ id: "123", type: "user" }, { id: "9", type: "guild" }, { id: "x", type: "role" }], min_values: 0, max_values: 25 }] },
    { type: 1, components: [{ type: 8, custom_id: "where", channel_types: [0, 2, "5", 1e400, 15], min_values: 26, max_values: 0 }] },
  ],
};

const WRONG: unknown[] = [null, true, false, 0, -1, 1e400, "", "x", "12345678901234567890123", "-5", [], [1, 2], {}, { a: 1 }, "javascript:alert(1)", "//evil.example/x", "https://a b.example", "/media/proxy/x\ty", "2026-10-03", "2026-10-03T12:00:00", "Sat, 03 Oct 2026 12:00:00 GMT", "2026-13-40T99:00:00Z", "+002026-10-03T00:00:00Z", 16777216, 16777215.7, 3.5];

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Changes one thing somewhere inside: a value swapped for a wrong one, a key dropped, a list cut. */
function mangle(x: unknown, depth = 0): unknown {
  if (Array.isArray(x)) {
    if (x.length && rand() < 0.7) {
      const k = int(x.length);
      x[k] = mangle(x[k], depth + 1);
    } else if (rand() < 0.5) x.length = int(x.length + 1);
    return x;
  }
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o);
    if (!keys.length) return o;
    const k = pick(keys);
    const r = rand();
    if (r < 0.2) delete o[k];
    else if (r < 0.55 || depth > 5) o[k] = pick(WRONG);
    else o[k] = mangle(o[k], depth + 1);
    return o;
  }
  return rand() < 0.5 ? pick(WRONG) : x;
}

function deep(n: number): unknown {
  let c: Record<string, unknown> = { type: 10, content: "deepest" };
  for (let k = 0; k < n; k++) c = { type: 17, components: [c] };
  return c;
}

const raws: unknown[] = [base, null, "text", [], {}, { name: "x".repeat(100) }, { name: "" }, { components: [deep(3), deep(4), deep(5), deep(7)] }];
for (let k = 0; k < 600; k++) {
  let r: unknown = clone(base);
  for (let n = 1 + int(4); n > 0; n--) r = mangle(r);
  raws.push(r);
}
raws.push(app);
for (let k = 0; k < 400; k++) {
  let r: unknown = clone(app);
  for (let n = 1 + int(4); n > 0; n--) r = mangle(r);
  raws.push(r);
}
// Discord's markdown as bots write it (discordMarkdown): spans across lines, fences mid-line
const flavored = ["**Syntax:\n**```\n!dm <user_id> <message>\n```", "**a\n  b**", "||s\np||", "t```py\nx=1```z", "`**` c\n**x**", "**open\nline"];
const bits = ["**", "__", "~~", "||", "```", "`", "\n", "\n", " ", "a", "b", "\u3000", "py"];
for (let k = 0; k < 300; k++) flavored.push(Array.from({ length: 2 + int(14) }, () => pick(bits)).join(""));
for (const text of flavored) raws.push({ ...clone(app) as object, content: text, embeds: [{ description: text, fields: [{ name: "f", value: text }] }] });

const cases = raws.map((raw) => {
  const out = sanitizeHook(raw);
  return {
    raw,
    out,
    text: out ? hookText(out) : null,
    listed: out ? listedAttachments(out) : null,
    media: out && out.embeds[0]?.thumbnail ? mediaAttachment(out, out.embeds[0].thumbnail) : null,
    same: out ? sameHookSender(out, sanitizeHook(base)!) : null,
    sameApp: out ? sameHookSender(out, sanitizeHook(app)!) : null,
  };
});

const dates = [
  "2026-10-03T12:00:00Z", "2026-10-03T12:00:00.123Z", "2026-10-03T12:00:00+02:00", "2026-10-03T12:00:00.5-07:30", "2026-10-03", "2026-10", "2026",
  "2026-10-03T12:00", "2026-10-03T12:00:00", "+002026-10-03T00:00:00Z", "-000001-01-01T00:00:00Z", "2026-13-01", "2026-02-30T00:00:00Z",
  "Sat, 03 Oct 2026 12:00:00 GMT", "-5", "x", "",
].map((s) => {
  const ms = Date.parse(s);
  return { s, ms: Number.isFinite(ms) ? ms : null };
});

writeFileSync(join(process.cwd(), "../android/app/src/test/resources/web-hook-vectors.json.gz"), gzipSync(JSON.stringify({ cases, dates }), { level: 9 }));
console.log("hook vectors:", cases.length);
