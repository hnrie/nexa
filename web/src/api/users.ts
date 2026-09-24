import { api } from "./client";
import type { PurgeCounts } from "./moderation";
import type { KdfParamsJson, MeUser, PublicUser, SettingsBlob, Snowflake } from "./types";

export type MePatch = Partial<{
  username: string;
  display_name: string;
  about_me: string | null;
  pronouns: string | null;
  accent_color: number | null;
  accent_color_2: number | null;
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
  /** What deleting the account would take with it. */
  deletePreview(): Promise<PurgeCounts> {
    return api.request<PurgeCounts>("GET", "/users/@me/delete-preview");
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

/**
 * The size to ask the server for so a picture drawn `css` pixels across stays
 * sharp on this screen: doubled or tripled for dense screens, then rounded up
 * to a power of two, which is what the server keeps copies at. Without it a
 * 32-pixel avatar would come as uploaded, and a 4096-pixel one costs the
 * browser 64 MB to show.
 */
export function mediaSize(css: number): number {
  const density = typeof window !== "undefined" ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const want = Math.ceil(css * density);
  let size = 16;
  while (size < want && size < 1024) size *= 2;
  return size;
}

function mediaUrl(kind: string, id: Snowflake | null, css?: number): string | null {
  if (!id) return null;
  const url = `${api.baseUrl}/media/${kind}/${id}`;
  return css ? `${url}?size=${mediaSize(css)}` : url;
}

/** `css` is how many pixels across it is drawn; leave it out for the original. */
export function avatarUrl(id: Snowflake | null, css?: number): string | null {
  return mediaUrl("avatar", id, css);
}
export function bannerUrl(id: Snowflake | null, css?: number): string | null {
  return mediaUrl("banner", id, css);
}
export function iconUrl(id: Snowflake | null, css?: number): string | null {
  return mediaUrl("icon", id, css);
}
export function emojiUrl(id: Snowflake, _animated: boolean, css?: number): string {
  return mediaUrl("emoji", id, css) ?? "";
}
export function stickerUrl(id: Snowflake, css?: number): string {
  return mediaUrl("sticker", id, css) ?? "";
}
