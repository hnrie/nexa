import { api } from "./client";
import type { PollTally, Snowflake, Webhook } from "./types";

export interface WebhookPatch {
  name?: string;
  /** Image data ("data:image/png;base64,..."), or null to take the picture away. */
  avatar?: string | null;
  channel_id?: Snowflake;
}

/** Incoming webhooks, as the people who manage a server's see them, and votes on their polls. */
export const webhooks = {
  forServer: (serverId: Snowflake) => api.request<Webhook[]>("GET", `/servers/${serverId}/webhooks`),
  forChannel: (channelId: Snowflake) => api.request<Webhook[]>("GET", `/channels/${channelId}/webhooks`),
  create: (channelId: Snowflake, name: string, avatar?: string | null) => api.request<Webhook>("POST", `/channels/${channelId}/webhooks`, avatar ? { name, avatar } : { name }),
  update: (id: Snowflake, patch: WebhookPatch) => api.request<Webhook>("PATCH", `/webhooks/${id}`, patch),
  remove: (id: Snowflake) => api.request<void>("DELETE", `/webhooks/${id}`),
  /** Makes this account's votes on a poll exactly these answers; none takes them back. */
  vote: (channelId: Snowflake, messageId: Snowflake, answerIds: number[]) => api.request<PollTally>("PUT", `/channels/${channelId}/polls/${messageId}/answers/@me`, { answer_ids: answerIds }),
  voters: (channelId: Snowflake, messageId: Snowflake, answerId: number) => api.request<{ users: Snowflake[] }>("GET", `/channels/${channelId}/polls/${messageId}/answers/${answerId}?limit=100`),
};
