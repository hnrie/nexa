import type { Channel } from "@/api/types";
import type { ChannelRead } from "@/stores/readStates";
import { isUnread } from "@/stores/readStates";
import type { Settings } from "@/stores/settings";

export interface UnreadSummary {
  unread: boolean;
  mentions: number;
}

/** Whether notifications for a channel (and its server) are muted in settings. */
export function isMuted(settings: Settings, channelId: string, serverId: string | null | undefined): boolean {
  const { muted, perChannel } = settings.notifications;
  if (muted.includes(channelId)) return true;
  if (serverId && muted.includes(serverId)) return true;
  const level = perChannel[channelId] ?? (serverId ? perChannel[serverId] : undefined);
  return level === "none";
}

/** Aggregates unread state over a server's text channels, honouring mutes. */
export function serverUnread(serverId: string, channels: Record<string, Channel>, reads: Record<string, ChannelRead>, settings: Settings): UnreadSummary {
  let unread = false;
  let mentions = 0;
  const serverMuted = settings.notifications.muted.includes(serverId);
  for (const ch of Object.values(channels)) {
    if (ch.server_id !== serverId || ch.type !== "text") continue;
    const rs = reads[ch.id];
    mentions += rs?.mentions ?? 0;
    if (!serverMuted && !settings.notifications.muted.includes(ch.id) && isUnread(rs, ch.last_message_id)) unread = true;
  }
  return { unread, mentions };
}
