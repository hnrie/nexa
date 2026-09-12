import { api, errorFromResponse } from "./client";
import type { Channel, Message, Snowflake } from "./types";

type Progress = (loaded: number, total: number) => void;

export function attachmentUrl(blobId: Snowflake): string {
  return `${api.baseUrl}/media/attachments/${blobId}`;
}

export const channels = {
  createDM(recipientIds: Snowflake[], name?: string): Promise<Channel> {
    const body: { recipient_ids: Snowflake[]; name?: string } = { recipient_ids: recipientIds };
    if (name !== undefined) body.name = name;
    return api.request<Channel>("POST", "/users/@me/channels", body);
  },
  listDMs(): Promise<Channel[]> {
    return api.request<Channel[]>("GET", "/users/@me/channels");
  },
  get(id: Snowflake): Promise<Channel> {
    return api.request<Channel>("GET", `/channels/${id}`);
  },
  patch(id: Snowflake, body: { name?: string; owner_id?: Snowflake }): Promise<Channel> {
    return api.request<Channel>("PATCH", `/channels/${id}`, body);
  },
  uploadIcon(id: Snowflake, file: Blob, onProgress?: Progress): Promise<Channel> {
    const opts: { method: string; headers: Record<string, string>; onProgress?: Progress } = {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
    };
    if (onProgress) opts.onProgress = onProgress;
    return api.upload<Channel>(`/channels/${id}/icon`, file, opts);
  },
  deleteIcon(id: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${id}/icon`);
  },
  addRecipient(id: Snowflake, uid: Snowflake): Promise<Channel> {
    return api.request<Channel>("POST", `/channels/${id}/recipients/${uid}`);
  },
  removeRecipient(id: Snowflake, uid: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${id}/recipients/${uid}`);
  },
  typing(id: Snowflake): Promise<void> {
    return api.request<void>("POST", `/channels/${id}/typing`);
  },
  uploadAttachment(
    channelId: Snowflake,
    data: Blob | Uint8Array,
    onProgress?: Progress,
  ): Promise<{ blob_id: Snowflake; size: number; channel_id: Snowflake }> {
    const opts: { onProgress?: Progress } = {};
    if (onProgress) opts.onProgress = onProgress;
    return api.upload(`/channels/${channelId}/attachments`, data, opts);
  },
  async downloadAttachment(blobId: Snowflake, signal?: AbortSignal): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {};
    const token = api.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method: "GET", headers };
    if (signal) init.signal = signal;
    const res = await api.fetchImpl(attachmentUrl(blobId), init);
    if (!res.ok) throw await errorFromResponse(res);
    return res.arrayBuffer();
  },
  pins(id: Snowflake): Promise<Message[]> {
    return api.request<Message[]>("GET", `/channels/${id}/pins`);
  },
  pin(id: Snowflake, mid: Snowflake): Promise<void> {
    return api.request<void>("PUT", `/channels/${id}/pins/${mid}`);
  },
  unpin(id: Snowflake, mid: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${id}/pins/${mid}`);
  },
};
