import { api } from "./client";
import type { Message, ReadState, SendMessageRequest, Snowflake } from "./types";

export interface HistoryQuery {
  before?: Snowflake;
  after?: Snowflake;
  around?: Snowflake;
  limit?: number;
}

const reactionPath = (channelId: Snowflake, mid: Snowflake, emoji: string): string =>
  `/channels/${channelId}/messages/${mid}/reactions/${encodeURIComponent(emoji)}`;

export const messages = {
  list(channelId: Snowflake, q: HistoryQuery = {}): Promise<Message[]> {
    return api.request<Message[]>("GET", `/channels/${channelId}/messages`, undefined, {
      query: { before: q.before, after: q.after, around: q.around, limit: q.limit },
    });
  },
  get(channelId: Snowflake, mid: Snowflake): Promise<Message> {
    return api.request<Message>("GET", `/channels/${channelId}/messages/${mid}`);
  },
  send(channelId: Snowflake, body: SendMessageRequest): Promise<Message> {
    return api.request<Message>("POST", `/channels/${channelId}/messages`, body);
  },
  edit(channelId: Snowflake, mid: Snowflake, body: Partial<SendMessageRequest>): Promise<Message> {
    return api.request<Message>("PATCH", `/channels/${channelId}/messages/${mid}`, body);
  },
  remove(channelId: Snowflake, mid: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${channelId}/messages/${mid}`);
  },
  ack(channelId: Snowflake, mid: Snowflake): Promise<ReadState> {
    return api.request<ReadState>("POST", `/channels/${channelId}/messages/${mid}/ack`);
  },
  react(channelId: Snowflake, mid: Snowflake, emoji: string): Promise<void> {
    return api.request<void>("PUT", `${reactionPath(channelId, mid, emoji)}/@me`);
  },
  unreact(channelId: Snowflake, mid: Snowflake, emoji: string): Promise<void> {
    return api.request<void>("DELETE", `${reactionPath(channelId, mid, emoji)}/@me`);
  },
  reactors(channelId: Snowflake, mid: Snowflake, emoji: string, limit?: number): Promise<Snowflake[]> {
    return api.request<Snowflake[]>("GET", reactionPath(channelId, mid, emoji), undefined, { query: { limit } });
  },
};
