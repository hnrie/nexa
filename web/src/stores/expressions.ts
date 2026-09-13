import { create } from "zustand";
import type { Emoji, Sticker, StickerPack } from "@/api/types";
import { emojiUrl, stickerUrl } from "@/api/users";

interface ExpressionsState {
  /** Custom emoji per server. */
  emojis: Record<string, Emoji[]>;
  /** Every sticker pack the user owns, installed, or shares a server with. */
  packs: Record<string, StickerPack>;
  /** Whether the server has GIF search configured; null until asked. */
  gifEnabled: boolean | null;
  setEmojis: (serverId: string, list: Emoji[]) => void;
  setAllEmojis: (list: Emoji[]) => void;
  removeServer: (serverId: string) => void;
  setPacks: (list: StickerPack[]) => void;
  upsertPack: (pack: StickerPack) => void;
  removePack: (id: string) => void;
  setGifEnabled: (v: boolean) => void;
  clear: () => void;
}

export const useExpressions = create<ExpressionsState>()((set) => ({
  emojis: {},
  packs: {},
  gifEnabled: null,
  setEmojis: (serverId, list) => set((s) => ({ emojis: { ...s.emojis, [serverId]: list } })),
  setAllEmojis: (list) => {
    const emojis: Record<string, Emoji[]> = {};
    for (const e of list) (emojis[e.server_id] ??= []).push(e);
    set({ emojis });
  },
  removeServer: (serverId) =>
    set((s) => {
      if (!(serverId in s.emojis)) return s;
      const emojis = { ...s.emojis };
      delete emojis[serverId];
      const packs = { ...s.packs };
      for (const [id, p] of Object.entries(packs)) if (p.server_id === serverId) delete packs[id];
      return { emojis, packs };
    }),
  setPacks: (list) => {
    const packs: Record<string, StickerPack> = {};
    for (const p of list) packs[p.id] = p;
    set({ packs });
  },
  upsertPack: (pack) => set((s) => ({ packs: { ...s.packs, [pack.id]: pack } })),
  removePack: (id) =>
    set((s) => {
      if (!(id in s.packs)) return s;
      const packs = { ...s.packs };
      delete packs[id];
      return { packs };
    }),
  setGifEnabled: (gifEnabled) => set({ gifEnabled }),
  clear: () => set({ emojis: {}, packs: {}, gifEnabled: null }),
}));

/** Emoji that come from installed or owned emoji packs, as picker entries. */
export function packEmoji(packs: Record<string, StickerPack>): { pack: StickerPack; items: Sticker[] }[] {
  return Object.values(packs)
    .filter((p) => p.kind === "emoji" && p.stickers.length > 0)
    .sort((a, b) => b.updated_at - a.updated_at)
    .map((pack) => ({ pack, items: pack.stickers }));
}

/** Every custom emoji the user can use, with its server id. */
export function allCustomEmoji(emojis: Record<string, Emoji[]>): Emoji[] {
  return Object.values(emojis).flat();
}

/** Custom emoji whose name starts with or contains the query. */
export function searchCustomEmoji(emojis: Record<string, Emoji[]>, q: string, limit = 20): Emoji[] {
  const query = q.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!query) return [];
  const scored: { e: Emoji; s: number }[] = [];
  for (const e of allCustomEmoji(emojis)) {
    const n = e.name.toLowerCase();
    if (n === query) scored.push({ e, s: 100 });
    else if (n.startsWith(query)) scored.push({ e, s: 80 });
    else if (n.includes(query)) scored.push({ e, s: 40 });
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}

/**
 * The markdown token for a custom emoji. The id inside the token is the image's
 * blob id, so the emoji renders for everyone, in any channel or DM, even people
 * who are not in the server it came from.
 */
export function emojiToken(e: { name: string; blob_id: string; animated: boolean }): string {
  return `<${e.animated ? "a" : ""}:${e.name}:${e.blob_id}>`;
}

/** The reaction key for a custom emoji (what the server stores): a?:name:blobId. */
export function emojiReactionKey(e: { name: string; blob_id: string; animated: boolean }): string {
  return `${e.animated ? "a" : ""}:${e.name}:${e.blob_id}`;
}

export interface PackGroup {
  label: string;
  packs: StickerPack[];
}

/** Packs grouped for the picker: this server's, mine, then installed. */
export function groupPacks(packs: Record<string, StickerPack>, serverId: string | null | undefined, meId: string | undefined): PackGroup[] {
  const list = Object.values(packs).filter((p) => p.kind !== "emoji").sort((a, b) => b.updated_at - a.updated_at);
  const groups: PackGroup[] = [];
  const server = list.filter((p) => serverId && p.server_id === serverId);
  const mine = list.filter((p) => p.owner_user_id && p.owner_user_id === meId);
  const installed = list.filter((p) => p.installed && !(p.owner_user_id && p.owner_user_id === meId));
  const otherServers = list.filter((p) => p.server_id && p.server_id !== serverId);
  if (server.length) groups.push({ label: "This server", packs: server });
  if (mine.length) groups.push({ label: "My packs", packs: mine });
  if (installed.length) groups.push({ label: "Installed", packs: installed });
  if (otherServers.length) groups.push({ label: "Other servers", packs: otherServers });
  return groups;
}

/** Pack emoji whose name matches, for the picker search and the composer. */
export function searchPackEmoji(packs: Record<string, StickerPack>, q: string, limit = 20): { sticker: Sticker; pack: StickerPack }[] {
  const query = q.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!query) return [];
  const out: { sticker: Sticker; pack: StickerPack; s: number }[] = [];
  for (const pack of Object.values(packs)) {
    if (pack.kind !== "emoji") continue;
    for (const sticker of pack.stickers) {
      const n = sticker.name.toLowerCase();
      if (n === query) out.push({ sticker, pack, s: 100 });
      else if (n.startsWith(query)) out.push({ sticker, pack, s: 80 });
      else if (n.includes(query)) out.push({ sticker, pack, s: 40 });
    }
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map(({ sticker, pack }) => ({ sticker, pack }));
}

/** Stickers matching a query by name or tag, across the given packs. */
export function searchStickers(packs: StickerPack[], q: string, limit = 60): { sticker: Sticker; pack: StickerPack }[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const out: { sticker: Sticker; pack: StickerPack; s: number }[] = [];
  for (const pack of packs) {
    for (const sticker of pack.stickers) {
      const name = sticker.name.toLowerCase();
      const tags = sticker.tags.toLowerCase();
      let s = -1;
      if (name === query) s = 100;
      else if (name.startsWith(query)) s = 80;
      else if (name.includes(query)) s = 50;
      else if (tags.split(/\s+/).some((t) => t.startsWith(query))) s = 40;
      else if (pack.name.toLowerCase().includes(query)) s = 20;
      if (s >= 0) out.push({ sticker, pack, s });
    }
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map(({ sticker, pack }) => ({ sticker, pack }));
}

/** Where a pack's image lives: emoji packs store emoji-kind blobs. */
export function packImageUrl(pack: StickerPack, sticker: Sticker): string {
  return pack.kind === "emoji" ? emojiUrl(sticker.blob_id, sticker.animated, 48) : stickerUrl(sticker.blob_id, 160);
}
