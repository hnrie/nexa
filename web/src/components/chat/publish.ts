import { ApiError } from "@/api/client";
import { MSG_FLAG_PUBLISHED } from "@/api/types";
import { t } from "@/i18n";
import type { DecryptedMessage } from "@/lib/decrypt";
import { publishPost } from "@/lib/follows";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { canI, P, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";

/** Whether a post of an announcement channel has gone out to the channels following it. */
export function isPublished(msg: Pick<DecryptedMessage, "flags" | "published">): boolean {
  return !!msg.published || (msg.flags & MSG_FLAG_PUBLISHED) !== 0;
}

/**
 * Whether this account may publish a message: one written in an announcement
 * channel, not yet published, by this account (who can send there) or by
 * anyone when this account may manage messages there.
 */
export function canPublish(msg: DecryptedMessage): boolean {
  if ((msg.type !== "default" && msg.type !== "reply") || !msg.payload || isPublished(msg)) return false;
  const ch = useChannels.getState().byId[msg.channel_id];
  if (ch?.type !== "announcement" || !ch.server_id) return false;
  const st = useServers.getState().byId[ch.server_id];
  const me = useAuth.getState().me;
  if (!me) return false;
  if (msg.author_id === me.id && canI(st, P.SEND_MESSAGES, ch.id)) return true;
  return canI(st, P.MANAGE_MESSAGES, ch.id);
}

/** Publishes a post to every channel following its channel, each copy sealed to that follow. */
export async function publish(msg: DecryptedMessage): Promise<void> {
  if (!msg.payload) return;
  const ui = useUI.getState();
  try {
    const { copies } = await publishPost(msg.channel_id, msg.id, msg.payload);
    useMessages.getState().setFlags(msg.channel_id, msg.id, msg.flags | MSG_FLAG_PUBLISHED);
    ui.toast(copies === 0 ? t("follows.publishedNone") : t("follows.publishedTo", { count: copies }), "success");
  } catch (err) {
    if (err instanceof ApiError && err.code === "publish_limit") ui.toast(t("follows.publishLimit"), "error");
    else ui.toast(err instanceof ApiError ? err.message : t("follows.publishFailed"), "error");
  }
}

/** An edit to a published post goes out to its copies too. */
export async function republish(msg: DecryptedMessage): Promise<void> {
  if (!msg.payload || !isPublished(msg)) return;
  try {
    await publishPost(msg.channel_id, msg.id, msg.payload);
  } catch {
    useUI.getState().toast(t("follows.republishFailed"), "error");
  }
}
