import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { displayName, useUsers } from "@/stores/users";
import { t } from "@/i18n";

/**
 * The name a person goes by in a conversation: their nickname in that server,
 * else the nickname you gave them as a friend, else their display name. The
 * message header, a reply's quote and the reply bar all say it the same way;
 * each subscribes to that one person, not to everyone.
 */
export function useShownName(channelId: string, userId: string | undefined): string {
  const user = useUsers((u) => (userId ? u.byId[userId] : undefined));
  const me = useAuth((a) => a.me);
  const serverId = useChannels((c) => c.byId[channelId]?.server_id ?? null);
  const nick = useServers((st) => (serverId && userId ? st.byId[serverId]?.members[userId]?.nickname : undefined));
  const friend = useRelationships((r) => (userId ? r.byUser[userId]?.nickname : undefined));
  const base = displayName(user, userId && userId === me?.id ? me.display_name : t("names.unknownUser"));
  return nick || friend || base;
}
