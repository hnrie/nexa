import { threads as threadsApi } from "@/api/threads";
import type { Channel } from "@/api/types";
import { screenForSend, sendMessage, sendWithFiles } from "@/components/composer/send";
import type { Staged } from "@/lib/attachments";
import { useChannels } from "@/stores/channels";
import { useThreads } from "@/stores/threads";

/**
 * Starts a post in a forum: the post, joined at once, and its first message,
 * sealed for the post and sent after it. AutoMod reads the message before
 * anything goes, so a post it stops never goes up: that comes back as null.
 * The first message is on its way when this returns, not yet sent.
 */
export async function startForumPost(forum: Channel, post: { name: string; body: string; appliedTags?: string[]; files?: Staged[] }): Promise<Channel | null> {
  const files = post.files ?? [];
  const screened = screenForSend(forum.id, post.body, files.map((f) => f.name));
  if (screened?.stopped) return null;
  const res = await threadsApi.create(forum.id, { name: post.name, applied_tags: post.appliedTags ?? [] });
  const thread = res.thread;
  useChannels.getState().upsert(thread);
  useThreads.getState().setJoined(thread.id, true);
  // the post's first message, sealed for the post: it goes up for everyone with it
  if (files.length) void sendWithFiles(thread.id, post.body, files).catch(() => undefined);
  else void sendMessage(thread.id, post.body).catch(() => undefined);
  return thread;
}
