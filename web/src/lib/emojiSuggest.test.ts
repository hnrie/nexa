import { describe, expect, it } from "vitest";
import type { Emoji } from "@/api/types";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { nameMatch, STARTER_EMOJI, suggestEmoji, useBoost, wordsOf, type EmojiCandidate } from "./emojiSuggest";
import { customKey, unicodeKey, withUse } from "./emojiUsage";

const entry = (unicode: string, shortcodes: string[], label: string, tags: string[] = []): EmojiCandidate => ({
  kind: "emoji",
  entry: { unicode, hexcode: "", label, group: 0, tags, shortcodes } as EmojiEntry,
});
const custom = (name: string, blob: string, own = false): EmojiCandidate => ({ kind: "customEmoji", emoji: { id: `e${blob}`, server_id: "s", name, blob_id: blob, animated: false } as Emoji, own });

const set: EmojiCandidate[] = [
  entry("❤️", ["heart"], "red heart", ["love"]),
  entry("😍", ["heart_eyes"], "smiling face with heart-eyes"),
  entry("💓", ["heartbeat"], "beating heart"),
  entry("💗", ["heartpulse"], "growing heart"),
  entry("💝", ["gift_heart"], "heart with ribbon"),
  entry("🙉", ["hear_no_evil"], "hear-no-evil monkey"),
  entry("✔️", ["heavy_check_mark"], "check mark"),
  entry("🎧", ["headphones"], "headphone"),
  entry("🤕", ["face_with_head_bandage"], "face with head-bandage"),
  entry("💔", ["broken_heart"], "broken heart"),
  entry("👍", ["thumbsup", "+1", "thumbs_up"], "thumbs up"),
  entry("😂", ["joy"], "face with tears of joy", ["laugh"]),
  entry("🔥", ["fire"], "fire"),
];
const names = (list: EmojiCandidate[]) => list.map((c) => (c.kind === "emoji" ? c.entry.shortcodes[0] : c.emoji.name));

describe("matching names", () => {
  it("splits a name into its words, camel case included", () => {
    expect(wordsOf("broken_heart")).toEqual(["broken", "heart"]);
    expect(wordsOf("pepeLaugh")).toEqual(["pepe", "laugh"]);
    expect(wordsOf("heart-eyes cat")).toEqual(["heart", "eyes", "cat"]);
  });

  it("finds a word inside a name, several words' starts, and initials", () => {
    expect(nameMatch("broken_heart", "hea")).toBeGreaterThan(0);
    expect(nameMatch("heart", "hea")).toBeGreaterThan(nameMatch("broken_heart", "hea"));
    expect(nameMatch("heart", "heart")).toBe(100);
    expect(nameMatch("face_with_head_bandage", "face_band")).toBeGreaterThan(0);
    expect(nameMatch("thumbs_up", "tu")).toBeGreaterThan(0);
    expect(nameMatch("broken_heart", "xyz")).toBe(-1);
  });
});

describe("suggesting emoji", () => {
  const now = 1_000_000;

  it("goes by how well names match when nothing has been used", () => {
    const out = suggestEmoji({ query: "hea", candidates: set, usage: {}, recent: [], now });
    expect(names(out)[0]).toBe("heart");
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("puts the emoji someone uses first, so :hea finds their broken heart", () => {
    const usage = withUse({}, [unicodeKey("💔")], now);
    const out = suggestEmoji({ query: "hea", candidates: set, usage, recent: [], now });
    expect(names(out)[0]).toBe("broken_heart");
    // what was typed still counts: an unused emoji that matches as well stays behind it
    expect(names(out)).toContain("heart");
  });

  it("lifts what the picker sent lately a little, when nothing is counted yet", () => {
    const out = suggestEmoji({ query: "hea", candidates: set, usage: {}, recent: ["💓"], now });
    expect(names(out)[0]).toBe("heartbeat");
  });

  it("offers the emoji used most for a bare colon, then recent ones, then a few everyone uses", () => {
    let usage = withUse({}, [unicodeKey("🔥")], now);
    usage = withUse(usage, [unicodeKey("🔥"), unicodeKey("😂")], now);
    const out = suggestEmoji({ query: "", candidates: set, usage, recent: ["💔"], now });
    expect(names(out).slice(0, 3)).toEqual(["fire", "joy", "broken_heart"]);
    // the starters fill what is left, without repeating anything
    const starters = suggestEmoji({ query: "", candidates: set, usage: {}, recent: [], now });
    expect(starters.map((c) => (c.kind === "emoji" ? c.entry.unicode : ""))).toEqual(STARTER_EMOJI.filter((u) => set.some((c) => c.kind === "emoji" && unicodeKey(c.entry.unicode) === unicodeKey(u))));
  });

  it("ranks custom emoji with the rest, this server's a hair ahead, each emoji once", () => {
    const list = [custom("heart_party", "1", true), custom("heart_party", "2"), ...set];
    const usage = withUse({}, [customKey("2")], now);
    const out = suggestEmoji({ query: "heart_p", candidates: list, usage, recent: [], now });
    expect(out[0]!.kind === "customEmoji" && out[0]!.emoji.blob_id).toBe("2");
    expect(out.filter((c) => c.kind === "customEmoji")).toHaveLength(2);
  });

  it("lifts more the more something is used, up to a point", () => {
    expect(useBoost(0)).toBe(0);
    expect(useBoost(1)).toBeGreaterThan(0);
    expect(useBoost(10)).toBeGreaterThan(useBoost(1));
    expect(useBoost(1e9)).toBe(70);
  });
});
