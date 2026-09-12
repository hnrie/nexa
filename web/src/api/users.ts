import { api } from "./client";
import type { KdfParamsJson, MeUser, PublicUser, SettingsBlob, Snowflake } from "./types";

export type MePatch = Partial<{
  username: string;
  display_name: string;
  about_me: string | null;
  pronouns: string | null;
  accent_color: number | null;
  status_text: string | null;
  status_emoji: string | null;
  status_expires_at: number | null;
  presence_pref: MeUser["presence_pref"];
  dm_privacy: MeUser["dm_privacy"];
}>;

type Progress = (loaded: number, total: number) => void;

function putImage<T>(path: string, file: Blob, onProgress?: Progress): Promise<T> {
  const opts: { method: string; headers: Record<string, string>; onProgress?: Progress } = {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
  };
  if (onProgress) opts.onProgress = onProgress;
  return api.upload<T>(path, file, opts);
}

export const users = {
  me(): Promise<MeUser> {
    return api.request<MeUser>("GET", "/users/@me");
  },
  patchMe(patch: MePatch): Promise<MeUser> {
    return api.request<MeUser>("PATCH", "/users/@me", patch);
  },
  deleteMe(auth_key: string): Promise<void> {
    return api.request<void>("POST", "/users/@me/delete", { auth_key });
  },
  get(id: Snowflake): Promise<PublicUser> {
    return api.request<PublicUser>("GET", `/users/${id}`);
  },
  profile(id: Snowflake): Promise<{ user: PublicUser; mutual_friends: Snowflake[]; mutual_servers: Snowflake[] }> {
    return api.request("GET", `/users/${id}/profile`);
  },
  search(q: string): Promise<PublicUser[]> {
    return api.request<PublicUser[]>("GET", "/users/search", undefined, { query: { q } });
  },
  async getSettings(): Promise<SettingsBlob | null> {
    const res = await api.request<SettingsBlob | undefined>("GET", "/users/@me/settings");
    return res && typeof res.blob === "string" ? res : null;
  },
  putSettings(blob: string, version: number): Promise<{ version: number }> {
    return api.request("PUT", "/users/@me/settings", { blob, version });
  },
  myKeys(): Promise<{ public_key: string; enc_private_key: string; kdf_salt: string; kdf_params: KdfParamsJson }> {
    return api.request("GET", "/users/@me/keys");
  },
  publicKey(id: Snowflake): Promise<{ user_id: Snowflake; public_key: string }> {
    return api.request("GET", `/users/${id}/public-key`);
  },
  uploadAvatar(file: Blob, onProgress?: Progress): Promise<{ avatar_id: Snowflake; user: MeUser }> {
    return putImage("/users/@me/avatar", file, onProgress);
  },
  deleteAvatar(): Promise<void> {
    return api.request<void>("DELETE", "/users/@me/avatar");
  },
  uploadBanner(file: Blob, onProgress?: Progress): Promise<{ banner_id: Snowflake; user: MeUser }> {
    return putImage("/users/@me/banner", file, onProgress);
  },
  deleteBanner(): Promise<void> {
    return api.request<void>("DELETE", "/users/@me/banner");
  },
};

function mediaUrl(kind: string, id: Snowflake | null): string | null {
  return id ? `${api.baseUrl}/media/${kind}/${id}` : null;
}

export function avatarUrl(id: Snowflake | null, _fallbackSeed?: string): string | null {
  return mediaUrl("avatar", id);
}
export function bannerUrl(id: Snowflake | null): string | null {
  return mediaUrl("banner", id);
}
export function iconUrl(id: Snowflake | null): string | null {
  return mediaUrl("icon", id);
}
export function emojiUrl(id: Snowflake, _animated: boolean): string {
  return `${api.baseUrl}/media/emoji/${id}`;
}
export function stickerUrl(id: Snowflake): string {
  return `${api.baseUrl}/media/sticker/${id}`;
}
