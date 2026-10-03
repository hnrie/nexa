#!/usr/bin/env node
// Writes the emoji data the app reads from its assets, from the same
// emojibase-data package the web client imports (web/node_modules), kept in
// the order JavaScript reads it so names that collide resolve the same way:
//
//   assets/emoji/shortcodes.json  {"iamcal": [[hexcode, [names]]...], "emojibase": [...]}
//                                 what `:name:` means (lib/shortcodes.ts)
//   assets/emoji/emoji.json       [[unicode, hexcode, label, group|null, order|null, [tags], [[hexcode, unicode, tone|null]...]]...]
//                                 the picker's list (components/pickers/emojiIndex.ts)
//
//   node android/tools/emoji_assets.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web/node_modules/emojibase-data/", import.meta.url));
const out = fileURLToPath(new URL("../app/src/main/assets/emoji/", import.meta.url));
const read = (p) => JSON.parse(readFileSync(web + p, "utf8"));

const pairs = (obj) => Object.entries(obj).map(([hex, raw]) => [hex, Array.isArray(raw) ? raw : [raw]]);

mkdirSync(out, { recursive: true });
const version = JSON.parse(readFileSync(web + "package.json", "utf8")).version;
writeFileSync(
  out + "shortcodes.json",
  JSON.stringify({ version, iamcal: pairs(read("en/shortcodes/iamcal.json")), emojibase: pairs(read("en/shortcodes/emojibase.json")) }),
);

const compact = read("en/compact.json").map((e) => [
  e.unicode,
  e.hexcode,
  e.label,
  e.group ?? null,
  e.order ?? null,
  e.tags ?? [],
  (e.skins ?? []).map((s) => [s.hexcode, s.unicode, s.tone ?? null]),
]);
writeFileSync(out + "emoji.json", JSON.stringify({ version, emoji: compact }));
console.log("emojibase-data", version, "->", out);
