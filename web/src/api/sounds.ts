import { api } from "./client";
import type { Snowflake } from "./types";

export interface SoundFileRow {
  blob_id: Snowflake;
  size: number;
  created_at: number;
}

/**
 * The files behind custom sound packs. Each is sealed on the device before it
 * is sent; which file plays for what, and the keys that open them, travel in
 * the account's encrypted settings (lib/soundPacks.ts).
 */
export const sounds = {
  list(): Promise<{ sounds: SoundFileRow[]; max: number; max_bytes: number }> {
    return api.request("GET", "/users/@me/sounds");
  },
  upload(sealed: Blob, signal?: AbortSignal): Promise<{ blob_id: Snowflake; size: number }> {
    return api.upload("/users/@me/sounds", sealed, signal ? { signal } : undefined);
  },
  remove(blobId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/users/@me/sounds/${blobId}`);
  },
};
