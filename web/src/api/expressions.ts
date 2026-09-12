import { api } from "./client";
import type { Emoji, GifPage, Snowflake, Sticker, StickerPack } from "./types";

type Progress = (loaded: number, total: number) => void;

function upload<T>(path: string, file: Blob, onProgress?: Progress): Promise<T> {
  const opts: { method: string; headers: Record<string, string>; onProgress?: Progress } = { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" } };
  if (onProgress) opts.onProgress = onProgress;
  return api.upload<T>(path, file, opts);
}

export const expressions = {
  emojis(serverId: Snowflake): Promise<Emoji[]> {
    return api.request<Emoji[]>("GET", `/servers/${serverId}/emojis`);
  },
  uploadEmoji(serverId: Snowflake, name: string, file: Blob, onProgress?: Progress): Promise<Emoji> {
    return upload<Emoji>(`/servers/${serverId}/emojis?name=${encodeURIComponent(name)}`, file, onProgress);
  },
  renameEmoji(serverId: Snowflake, emojiId: Snowflake, name: string): Promise<Emoji> {
    return api.request<Emoji>("PATCH", `/servers/${serverId}/emojis/${emojiId}`, { name });
  },
  deleteEmoji(serverId: Snowflake, emojiId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/servers/${serverId}/emojis/${emojiId}`);
  },
  packs(): Promise<StickerPack[]> {
    return api.request<StickerPack[]>("GET", "/stickers/packs");
  },
  publicPacks(q = "", limit = 50): Promise<StickerPack[]> {
    return api.request<StickerPack[]>("GET", "/stickers/packs/public", undefined, { query: { q, limit } });
  },
  pack(id: Snowflake): Promise<StickerPack> {
    return api.request<StickerPack>("GET", `/stickers/packs/${id}`);
  },
  createPack(body: { name: string; description?: string; server_id?: Snowflake; kind?: "sticker" | "emoji" }): Promise<StickerPack> {
    return api.request<StickerPack>("POST", "/stickers/packs", body);
  },
  patchPack(id: Snowflake, body: { name?: string; description?: string; public?: boolean; cover_sticker_id?: Snowflake | null }): Promise<StickerPack> {
    return api.request<StickerPack>("PATCH", `/stickers/packs/${id}`, body);
  },
  deletePack(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/stickers/packs/${id}`);
  },
  uploadSticker(packId: Snowflake, name: string, tags: string, file: Blob, onProgress?: Progress): Promise<Sticker> {
    return upload<Sticker>(`/stickers/packs/${packId}/stickers?name=${encodeURIComponent(name)}&tags=${encodeURIComponent(tags)}`, file, onProgress);
  },
  patchSticker(packId: Snowflake, stickerId: Snowflake, body: { name?: string; tags?: string }): Promise<Sticker> {
    return api.request<Sticker>("PATCH", `/stickers/packs/${packId}/stickers/${stickerId}`, body);
  },
  deleteSticker(packId: Snowflake, stickerId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/stickers/packs/${packId}/stickers/${stickerId}`);
  },
  setStickerPositions(packId: Snowflake, list: { id: Snowflake; position: number }[]): Promise<StickerPack> {
    return api.request<StickerPack>("PATCH", `/stickers/packs/${packId}/stickers`, list);
  },
  install(packId: Snowflake): Promise<StickerPack> {
    return api.request<StickerPack>("PUT", `/stickers/packs/${packId}/install`);
  },
  uninstall(packId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/stickers/packs/${packId}/install`);
  },
  gifStatus(): Promise<{ enabled: boolean }> {
    return api.request("GET", "/gif/status");
  },
  gifSearch(q: string, pos?: string): Promise<GifPage> {
    return api.request<GifPage>("GET", "/gif/search", undefined, { query: { q, pos } });
  },
  gifTrending(pos?: string): Promise<GifPage> {
    return api.request<GifPage>("GET", "/gif/trending", undefined, { query: { pos } });
  },
};
