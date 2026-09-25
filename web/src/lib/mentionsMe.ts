import type { Message } from "@/api/types";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";

/**
 * Whether a message calls for this account: @everyone, a mention of it, or a
 * mention of a role it holds in the server the message was sent in. Roles are
 * read from this account's membership as it is now, the way the server counts
 * the unread badge, so a role given or taken away since counts as it is.
 */
export function mentionsMe(m: Pick<Message, "channel_id" | "mentions" | "mention_roles" | "mention_everyone">, meId: string): boolean {
  if (m.mention_everyone || m.mentions.includes(meId)) return true;
  if (!m.mention_roles?.length) return false;
  const serverId = useChannels.getState().byId[m.channel_id]?.server_id;
  if (!serverId) return false;
  const mine = useServers.getState().byId[serverId]?.me?.role_ids;
  return !!mine?.length && m.mention_roles.some((r) => mine.includes(r));
}
