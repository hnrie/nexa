import { api } from "./client";
import type { Snowflake } from "./types";

export interface UploadSession {
  id: Snowflake;
  size: number;
  received: number;
  chunk_size: number;
}

/**
 * Transfers too large for one request. The file goes up in pieces, each one
 * placed at the offset the server says it is expecting, so a dropped
 * connection costs one piece rather than the whole upload.
 */
export const uploads = {
  create(size: number): Promise<UploadSession> {
    return api.request<UploadSession>("POST", "/uploads", { size });
  },
  status(id: Snowflake): Promise<UploadSession> {
    return api.request<UploadSession>("GET", `/uploads/${id}`);
  },
  finish(id: Snowflake): Promise<{ blob_id: Snowflake; size: number }> {
    return api.request("POST", `/uploads/${id}/finish`);
  },
  cancel(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/uploads/${id}`);
  },
  /** Sends one piece, returning how much has landed in total. */
  async chunk(id: Snowflake, offset: number, body: Blob, onProgress?: (sent: number) => void, signal?: AbortSignal): Promise<number> {
    const res = await api.upload<UploadSession>(`/uploads/${id}`, body, {
      method: "PATCH",
      headers: { "Upload-Offset": String(offset) },
      ...(onProgress ? { onProgress: (loaded: number) => onProgress(loaded) } : {}),
      ...(signal ? { signal } : {}),
    });
    return res.received;
  },
};
