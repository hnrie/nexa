import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Emoji } from "@/api/types";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { learnEmojiHistory, nameMatch, STARTER_EMOJI, SUGGESTIONS, suggestEmoji, useBoost, wordsOf, type EmojiCandidate } from "./emojiSuggest";
import { customKey, unicodeKey, withUse } from "./emojiUsage";

const search = vi.hoisted(() => ({ mode: "disk" as string, docs: [] as { id: string; t: string; ts: number }[] }));
vi.mock("@/search/indexer", () => ({
  useSearchIndex: { getState: () => ({ mode: search.mode }) },
  querySearch: vi.fn(async () => ({ counts: {}, total: search.docs.length, docs: search.docs })),
}));

const entry = (unicode: string, shortcodes: string[], label: string, tags: string[] = [], group = 0): EmojiCandidate => ({
  kind: "emoji",
  entry: { unicode, hexcode: "", label, group, tags, shortcodes } as EmojiEntry,
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
  entry("👍", ["+1", "thumbsup", "thumbs_up"], "thumbs up"),
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
    expect(out.length).toBeLessThanOrEqual(SUGGESTIONS);
  });

  it("finds a name by any of its words, so broken_heart is among the first for :hea and :heart", () => {
    for (const query of ["hea", "heart"]) {
      const out = suggestEmoji({ query, candidates: set, usage: {}, recent: [], now });
      expect(names(out).indexOf("broken_heart"), query).toBeGreaterThanOrEqual(0);
      expect(names(out).indexOf("broken_heart"), query).toBeLessThan(5);
    }
    // what is common everywhere goes ahead of what is not, among matches as good
    const out = suggestEmoji({ query: "heart", candidates: set, usage: {}, recent: [], now });
    expect(names(out).indexOf("broken_heart")).toBeLessThan(names(out).indexOf("gift_heart"));
  });

  it("says which code matched, where it is not the emoji's first", () => {
    const out = suggestEmoji({ query: "thu", candidates: set, usage: {}, recent: [], now });
    expect(out[0]!.kind === "emoji" && out[0]!.entry.unicode).toBe("👍");
    expect(out[0]!.name).toBe("thumbsup");
  });

  it("keeps a country's flag behind other matches for a short query", () => {
    const list = [entry("🇹🇻", ["flag-tv", "tv"], "flag: Tuvalu", [], 9), entry("🌷", ["tulip"], "tulip"), ...set];
    const out = suggestEmoji({ query: "tu", candidates: list, usage: {}, recent: [], now });
    expect(out.map((c) => c.name).indexOf("tulip")).toBeLessThan(out.map((c) => c.name).indexOf("flag-tv"));
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

describe("learning from what was already sent", () => {
  beforeEach(() => {
    search.mode = "disk";
    search.docs = [];
    useSettings.setState({ loaded: true, settings: { ...DEFAULT_SETTINGS }, key: new Uint8Array(32) });
  });

  it("counts the emoji of this account's own messages, once, and offers them first", async () => {
    const now = Date.now();
    search.docs = [
      { id: "3", t: "ugh 💔💔", ts: now - 1000 },
      { id: "2", t: "so sad 💔", ts: now - 60_000 },
      { id: "1", t: "fine 👍", ts: now - 120_000 },
    ];
    expect(await learnEmojiHistory("me")).toBe(true);
    const st = useSettings.getState().settings;
    expect(st.emojiLearned).toBe(true);
    const out = suggestEmoji({ query: "hea", candidates: set, usage: st.emojiUsage, recent: [], now });
    expect(out[0]!.name).toBe("broken_heart");
    // and not again
    search.docs = [{ id: "4", t: "🔥🔥🔥", ts: now }];
    expect(await learnEmojiHistory("me")).toBe(false);
    expect(useSettings.getState().settings.emojiUsage[unicodeKey("🔥")]).toBeUndefined();
  });

  it("waits for the index to open, and learns nothing while smart suggestions are off", async () => {
    search.mode = "opening";
    search.docs = [{ id: "1", t: "💔", ts: Date.now() }];
    expect(await learnEmojiHistory("me")).toBe(false);
    expect(useSettings.getState().settings.emojiLearned).toBe(false);
    search.mode = "disk";
    useSettings.setState((s) => ({ settings: { ...s.settings, smartEmoji: false } }));
    expect(await learnEmojiHistory("me")).toBe(false);
    expect(useSettings.getState().settings.emojiUsage).toEqual({});
  });
});
