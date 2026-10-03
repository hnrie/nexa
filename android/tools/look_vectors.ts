// Writes android/app/src/test/resources/web-look-vectors.json.gz: what the
// web's own theme code (lib/color.ts, lib/look/*, lib/theme.ts) makes of the
// presets and of a few thousand seeded random inputs, for the Android port's
// tests to match exactly (fish.nexa.look.*).
//
// vite-node can only load files under web/, so this is copied there to run:
//
//   cp android/tools/look_vectors.ts web/look-vectors.gen.ts
//   (cd web && npx vite-node look-vectors.gen.ts)
//   rm web/look-vectors.gen.ts
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { ensureContrast, mixOk, parseColour, tuneForContrast, withLuminance } from "@/lib/color";
import { contrastIssues, fixContrast } from "@/lib/look/contrast";
import { exportTheme, importTheme, resolveCustom, sanitizeThemes } from "@/lib/look/customTheme";
import { deriveTheme, fitBackground, flipBackground } from "@/lib/look/derive";
import { PRESETS, presetTokens } from "@/lib/look/presets";
import { TOKENS } from "@/lib/look/tokens";
import { accentVarsOn, hardestSurface, resolveLook } from "@/lib/theme";

// mulberry32: the same draws on every run
let seed = 20261003;
const rand = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (n: number) => Math.floor(rand() * n);
const hex = () => "#" + [0, 1, 2].map(() => int(256).toString(16).padStart(2, "0")).join("");
const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;
const scheme = () => pick(["dark", "light"] as const);

const presets = Object.fromEntries(PRESETS.map((p) => [p.id, presetTokens(p.id)]));

const derive = Array.from({ length: 160 }, () => {
  const input = { background: hex(), accent: hex(), text: rand() < 0.3 ? hex() : null, scheme: scheme() };
  const high = rand() < 0.2;
  const d = deriveTheme(input, high ? { contrast: "high" } : {});
  return { input, high, tokens: d.tokens, background: d.background, adjusted: d.adjusted };
});

const fit = Array.from({ length: 300 }, () => {
  const bg = hex();
  const s = scheme();
  const high = rand() < 0.3;
  return { bg, scheme: s, high, fit: fitBackground(bg, s, high), flip: flipBackground(bg, s) };
});

const accents = Array.from({ length: 300 }, () => {
  const accent = hex();
  const surface = hex();
  const s = scheme();
  return { accent, surface, scheme: s, vars: accentVarsOn(accent, surface, s) };
});

const ensure = Array.from({ length: 400 }, () => {
  const colour = hex();
  const bgs = Array.from({ length: 1 + int(5) }, hex);
  const target = pick([2, 3, 4.5, 4.6, 7, 12]);
  return { colour, bgs, target, out: ensureContrast(colour, bgs, target) };
});

const mix = Array.from({ length: 300 }, () => {
  const a = hex();
  const b = hex();
  const t = Math.round(rand() * 100) / 100;
  return { a, b, t, out: mixOk(a, b, t) };
});

const luminances = Array.from({ length: 300 }, () => {
  const c = hex();
  const target = Math.round(rand() * 1000) / 1000;
  const side = pick(["nearest", "atLeast", "atMost"] as const);
  return { c, target, side, out: withLuminance(c, target, side) };
});

const tune = Array.from({ length: 300 }, () => {
  const c = hex();
  const bg = hex();
  const target = pick([3, 4.5, 7]);
  return { c, bg, target, out: tuneForContrast(c, bg, target) };
});

const parse = [
  "#abc", "#abcd", "#aabbcc", "#aabbcc80", "aabbcc", "#AABBCC", " #aabbcc ", "#ab", "#abcde", "#gggggg",
  "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "rgb(1 2 3 / 50%)", "rgb(255 255 255 / 1)", "rgb(256, 0, 0)", "rgba(1, 2, 3, 1.5)",
  "rgb(1.5, 2.25, 3)", "rgb(., 2, 3)", "rgb(1, 2, 3, .5)", "rgba(1 2 3)", "rgb(1,2)", "red", "", "#00000000", "#ffffffff", "#12345678",
].map((v) => ({ v, out: parseColour(v) }));

// themes with hand-set colours over them, some of them unreadable on purpose
const issues = Array.from({ length: 60 }, () => {
  const base = { ...pick(Object.values(presets))! } as Record<string, string>;
  for (let i = 0; i < 1 + int(6); i++) base[pick(TOKENS)] = rand() < 0.3 ? hex() + int(256).toString(16).padStart(2, "0") : hex();
  return { tokens: base, issues: contrastIssues(base as never), fixed: fixContrast(base as never) };
});

const rawThemes = [
  { id: "custom-abcdefgh", name: "  Dusk  ", source: { kind: "simple", background: "#102030", accent: "#ff8800", text: null, scheme: "dark" }, overrides: { link: "#66ccff", "--bg-hover": "rgba(255, 0, 0, 0.5)", nope: "#fff", "text-muted": "#12345680" } },
  { id: "custom-12345678", name: "Light One", source: { kind: "preset", id: "sky" }, overrides: {} },
  { id: "custom-bad", name: "x", source: { kind: "preset", id: "sky" }, overrides: {} },
  { id: "custom-abcdefgh", name: "duplicate", source: { kind: "preset", id: "dark" }, overrides: {} },
  { id: "custom-zzzzzzzz", name: 5, source: { kind: "simple", background: "#fafafa", accent: "rgb(10, 20, 30)", text: "#333", scheme: "neither" }, overrides: { "bg-raised": "#ffffff", "bg-overlay": "#00000080" } },
  { id: "custom-yyyyyyyy", name: "No accent", source: { kind: "simple", background: "#fafafa" }, overrides: {} },
  { id: "custom-xxxxxxxx", name: "Ash based", source: { kind: "preset", id: "ash" }, overrides: { "bg-raised": "#eeeeee" } },
];
const themes = sanitizeThemes(rawThemes);
const custom = { raw: rawThemes, sanitized: themes, resolved: themes.map((t) => resolveCustom(t)), exported: themes.map((t) => exportTheme(t)) };

const docs = [
  "not json", "[1,2]", '{"nexaTheme": 2}', '{"name": "  ", "simple": {"background": "#808080", "accent": "#ff0000", "scheme": "dark"}}',
  '{"name": "Based", "basedOn": "forest", "overrides": {"link": "#00ff00"}}', '{"name": "Colours", "colors": {"bg-raised": "#f0f0f0", "text": "#2e2c37", "link": "#123456"}}',
  '{"colours": {"bg-base": "#101010"}, "scheme": "light"}', '{"colors": {"nothing": "#fff"}}', exportTheme(themes[0]!),
];
const imports = docs.map((text) => {
  const r = importTheme(text, "Imported Theme");
  return { text, out: r.ok ? { ok: true, theme: { ...r.theme, id: "x" } } : r };
});

const looks = Array.from({ length: 80 }, () => {
  const theme = pick(["system", "dark", "light", "ash", "onyx", ...PRESETS.map((p) => p.id), "custom-abcdefgh", "custom-gone0000", "nonsense"]);
  const pair = rand() < 0.5 ? { dark: pick(["dark", "midnight", "custom-abcdefgh", "gone"]), light: pick(["light", "sky", "custom-12345678", "gone"]) } : undefined;
  const look = resolveLook({ theme, accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false, customThemes: themes, systemThemes: pair });
  return { theme, pair: pair ?? null, look, hardest: hardestSurface(look) };
});

const out = { presets, derive, fit, accents, ensure, mix, luminances, tune, parse, issues, custom, imports, looks };
writeFileSync("../android/app/src/test/resources/web-look-vectors.json.gz", gzipSync(JSON.stringify(out)));
console.log("wrote", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v as object).length])));
