import { api } from "./client";
import type { Channel, Message, PublicUser, SendMessageRequest, Snowflake, ThreadListing } from "./types";

export interface ThreadQuery {
  archived?: boolean;
  /** Where the page before ended: an archived_at for closed threads, otherwise a message or thread id (kept a string, as ids do not fit a number). */
  before?: number | string;
  limit?: number;
  q?: string;
  sort?: "activity" | "created";
  tags?: Snowflake[];
}

/** A thread as it is announced or created: the channel, and how many people are in it. */
export type ThreadView = Channel & { member_count: number };

export const threads = {
  /** Starts a thread: from a message, on its own, or as a forum post with its first message. */
  create(parentId: Snowflake, body: { name: string; message_id?: Snowflake; private?: boolean; auto_archive?: number; slowmode_seconds?: number; applied_tags?: Snowflake[]; message?: SendMessageRequest }): Promise<{ thread: ThreadView; message?: Message; key_actions?: { needs_own_key: boolean; conv_id: Snowflake } }> {
    return api.request("POST", `/channels/${parentId}/threads`, body);
  },
  list(parentId: Snowflake, q: ThreadQuery = {}): Promise<{ threads: ThreadListing[]; has_more: boolean; pinned_post?: Snowflake; users: PublicUser[] }> {
    const query: Record<string, string> = {};
    if (q.archived) query["archived"] = "1";
    if (q.before) query["before"] = String(q.before);
    if (q.limit) query["limit"] = String(q.limit);
    if (q.q) query["q"] = q.q;
    if (q.sort) query["sort"] = q.sort;
    if (q.tags?.length) query["tags"] = q.tags.join(",");
    return api.request("GET", `/channels/${parentId}/threads`, undefined, { query });
  },
  members(threadId: Snowflake): Promise<{ members: { thread_id: Snowflake; user_id: Snowflake; joined_at: number }[]; users: PublicUser[] }> {
    return api.request("GET", `/channels/${threadId}/thread-members`);
  },
  join(threadId: Snowflake): Promise<void> {
    return api.request<void>("PUT", `/channels/${threadId}/thread-members/@me`);
  },
  leave(threadId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${threadId}/thread-members/@me`);
  },
  add(threadId: Snowflake, userId: Snowflake): Promise<void> {
    return api.request<void>("PUT", `/channels/${threadId}/thread-members/${userId}`);
  },
  remove(threadId: Snowflake, userId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/channels/${threadId}/thread-members/${userId}`);
  },
  pinPost(forumId: Snowflake, threadId: Snowflake, pin: boolean): Promise<Channel> {
    return api.request<Channel>(pin ? "PUT" : "DELETE", `/channels/${forumId}/pinned-post/${threadId}`);
  },
};
