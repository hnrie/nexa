/**
 * Typing styles: how "is typing…" looks for someone to everyone else (the
 * server's api/typing_style.go). Up to three emoji that move together, how
 * they move, and the words after the name: one of the phrases every language
 * has, or the person's own. It shows only while one person is typing; with
 * several, the line goes back to naming them all.
 */
import { api } from "@/api/client";
import { mediaSize } from "@/api/users";
import { t } from "@/i18n";

export type TypingMotion = "wave" | "pulse" | "wiggle" | "still";

export interface TypingStyle {
  /** Up to three: an emoji itself, a server or pack emoji as messages write it (<:name:id>), or a picture of the person's own (img:<id>). */
  emoji: string[];
  motion: TypingMotion;
  /** One of TYPING_PRESETS, said in the reader's language. */
  preset?: string;
  /** The person's own words, shown as written. */
  words?: string;
}

/** The phrases on offer, by their key under typing.presets in every language. */
export const TYPING_PRESETS = ["yapping", "cooking", "plotting", "rambling", "overthinking", "daydreaming", "meowing", "essay", "tea", "thinking"] as const;
export const TYPING_MOTIONS: TypingMotion[] = ["wave", "pulse", "wiggle", "still"];
export const MAX_TYPING_EMOJI = 3;
export const MAX_TYPING_WORDS = 32;

const CUSTOM = /^<(a?):([A-Za-z0-9_]{1,32}):(\d{1,20})>$/;

const IMAGE = /^img:(\d{1,20})$/;

/** A picture of the person's own from its token ("img:<id>"), or null for an emoji. */
export function typingImage(token: string): string | null {
  return IMAGE.exec(token)?.[1] ?? null;
}

/** A typing picture's address at a size (internal/api/typing_style.go keeps them small). */
export function typingImageUrl(id: string, css: number): string {
  return `${api.baseUrl}/media/typing/${id}?size=${mediaSize(css)}`;
}

/** A server or pack emoji from its token, or null for an emoji that is itself. */
export function customEmoji(token: string): { id: string; name: string; animated: boolean } | null {
  const m = CUSTOM.exec(token);
  return m ? { id: m[3]!, name: m[2]!, animated: m[1] === "a" } : null;
}

/** A style as sent, read defensively: anything malformed is the plain style (null). */
export function readTypingStyle(x: unknown): TypingStyle | null {
  if (!x || typeof x !== "object") return null;
  const raw = x as Record<string, unknown>;
  const emoji = Array.isArray(raw["emoji"]) ? raw["emoji"].filter((e): e is string => typeof e === "string" && e.length > 0 && e.length <= 64).slice(0, MAX_TYPING_EMOJI) : [];
  const motion = TYPING_MOTIONS.includes(raw["motion"] as TypingMotion) ? (raw["motion"] as TypingMotion) : "wave";
  const words = typeof raw["words"] === "string" ? raw["words"].trim().slice(0, MAX_TYPING_WORDS) : "";
  const preset = typeof raw["preset"] === "string" && (TYPING_PRESETS as readonly string[]).includes(raw["preset"]) ? raw["preset"] : "";
  if (emoji.length === 0 && !words && !preset) return null;
  return { emoji, motion, ...(words ? { words } : preset ? { preset } : {}) };
}

/** Whether two styles look the same, for a form that saves only when something changed. */
export function sameTypingStyle(a: TypingStyle | null, b: TypingStyle | null): boolean {
  const norm = (s: TypingStyle | null) => (s ? JSON.stringify([s.emoji, s.motion, s.words ?? "", s.words ? "" : (s.preset ?? "")]) : "");
  return norm(a) === norm(b);
}

/** The words after the name: the preset in this language, the person's own, or the plain ones. */
export function typingWordsKey(style: TypingStyle | null): { key: string; words?: string } {
  if (style?.words) return { key: "typing.own", words: style.words };
  if (style?.preset) return { key: `typing.presets.${style.preset}` };
  return { key: "chat.typingBar.oneTyping" };
}

/** A typing style as one line of text for the staff: its emoji (a custom one as :name:, a picture as one), then its words. */
export function typingStyleText(style: TypingStyle | null): string {
  if (!style) return "";
  const emoji = style.emoji.map((e) => {
    // a picture of their own reads as one; its id says nothing
    if (typingImage(e)) return "🖼️";
    const custom = customEmoji(e);
    return custom ? `:${custom.name}:` : e;
  });
  return [...emoji, style.words || (style.preset ? presetLabel(style.preset) : "")].filter(Boolean).join(" ");
}

/** A preset's words without a name, for the choices in Settings; "" is the plain "is typing…". */
export function presetLabel(preset: string): string {
  return t(preset ? `typing.presets.${preset}` : "chat.typingBar.oneTyping", { a: "" }).trim();
}

/**
 * Emoji that go well together, for Surprise Me: each set a small story, so a
 * roll lands on something that reads as chosen rather than as noise.
 */
const SETS: string[][] = [
  ["🐸", "☕", "✨"],
  ["🔥", "🔥", "🔥"],
  ["🍳", "🧂", "👩‍🍳"],
  ["🧠", "💭", "🌀"],
  ["🐱", "🧶", "💤"],
  ["🌙", "⭐", "☁️"],
  ["🎮", "🕹️", "👾"],
  ["📚", "✍️", "🤓"],
  ["🫖", "🍰", "👀"],
  ["🦆", "🍞", "🌊"],
  ["🌸", "🍓", "🎀"],
  ["⚡", "🚀", "💥"],
  ["🐝", "🌻", "🍯"],
  ["🎧", "🎶", "💜"],
];

/** A style picked at random, a little different from the one shown before it. */
export function surpriseStyle(before: TypingStyle | null, random: () => number = Math.random): TypingStyle {
  const pick = <T,>(list: readonly T[], not?: T): T => {
    const pool = list.length > 1 && not !== undefined ? list.filter((x) => x !== not) : list;
    return pool[Math.floor(random() * pool.length)]!;
  };
  const set = pick(SETS, SETS.find((s) => before && s.join("") === before.emoji.join("")));
  const motion = pick(TYPING_MOTIONS.filter((m) => m !== "still"), before?.motion);
  const preset = pick(TYPING_PRESETS, before?.preset as (typeof TYPING_PRESETS)[number] | undefined);
  return { emoji: [...set], motion, preset };
}
