import { allEmoji, searchEmoji, type EmojiEntry } from "@/components/pickers/emojiIndex";
import { suggestEmoji, type EmojiCandidate } from "@/lib/emojiSuggest";
import { searchCustomEmoji, searchPackEmoji, useExpressions } from "@/stores/expressions";
import { useSettings } from "@/stores/settings";
import type { AcItem } from "./Autocomplete";

/** Unicode's emoji as suggestions, made once for the set. */
let unicodeCandidates: { from: EmojiEntry[]; list: EmojiCandidate[] } | null = null;
function unicodeEmojiCandidates(): EmojiCandidate[] {
  const all = allEmoji();
  if (unicodeCandidates?.from !== all) unicodeCandidates = { from: all, list: all.map((entry) => ({ kind: "emoji", entry })) };
  return unicodeCandidates.list;
}

/**
 * The emoji to offer for ":query" (the message box's, and an app command's
 * option boxes): this server's own first, as its :name: is the one a message
 * here gets, then others' and packs', then Unicode's. With Smart Emoji on, one
 * list ranked by how well each matches and how much this account uses it.
 */
export function emojiSuggestionItems(query: string, serverId: string | null | undefined): AcItem[] {
  const ex = useExpressions.getState();
  const sid = serverId ?? null;
  const st = useSettings.getState().settings;
  if (st.smartEmoji) {
    const packEmoji = Object.values(ex.packs)
      .filter((p) => p.kind === "emoji")
      .flatMap((p) => p.stickers.map((r) => ({ id: r.id, server_id: "", name: r.name, blob_id: r.blob_id, animated: r.animated, creator_id: r.creator_id, created_at: r.created_at })));
    const candidates: EmojiCandidate[] = [
      ...(sid ? (ex.emojis[sid] ?? []) : []).map((emoji): EmojiCandidate => ({ kind: "customEmoji", emoji, own: true })),
      ...Object.entries(ex.emojis).filter(([id]) => id !== sid).flatMap(([, list]) => list.map((emoji): EmojiCandidate => ({ kind: "customEmoji", emoji }))),
      ...packEmoji.map((emoji): EmojiCandidate => ({ kind: "customEmoji", emoji })),
      ...unicodeEmojiCandidates(),
    ];
    return suggestEmoji({ query, candidates, usage: st.emojiUsage, recent: st.recentEmoji, now: Date.now() }).map((c) => (c.kind === "emoji" ? { kind: "emoji", entry: c.entry, name: c.name } : { kind: "customEmoji", emoji: c.emoji }));
  }
  const others = Object.fromEntries(Object.entries(ex.emojis).filter(([id]) => id !== sid));
  const own = sid ? searchCustomEmoji({ [sid]: ex.emojis[sid] ?? [] }, query, 4) : [];
  const custom = [...own, ...searchCustomEmoji(others, query, 4 - own.length)].map((e) => ({ kind: "customEmoji" as const, emoji: e }));
  const fromPacks = searchPackEmoji(ex.packs, query, 4 - Math.min(custom.length, 4)).map((r) => ({
    kind: "customEmoji" as const,
    emoji: { id: r.sticker.id, server_id: "", name: r.sticker.name, blob_id: r.sticker.blob_id, animated: r.sticker.animated, creator_id: r.sticker.creator_id, created_at: r.sticker.created_at },
  }));
  const all = [...custom, ...fromPacks];
  return [...all, ...searchEmoji(query, Math.max(2, 8 - all.length)).map((e) => ({ kind: "emoji" as const, entry: e }))];
}
