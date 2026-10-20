import { BOT_READS_ALL_FLAG } from "@/api/types";
import { has, P } from "@/lib/perms";
import { channelPerms, useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";

/**
 * The apps that read every message in a channel: bots whose app has the
 * Message Content intent and that can see it. The server opens messages for
 * them, so here they are not end-to-end encrypted from those apps; the start
 * of the channel names them.
 */
export function useReadingApps(serverId: string | null, channelId: string): string[] {
  const users = useUsers((u) => u.byId);
  return useServers((x) => {
    const st = serverId ? x.byId[serverId] : undefined;
    if (!st) return EMPTY;
    const out: string[] = [];
    for (const id of Object.keys(st.members)) {
      const u = users[id];
      if (!u || (u.flags & BOT_READS_ALL_FLAG) === 0) continue;
      if (has(channelPerms(st, channelId, id), P.VIEW_CHANNEL)) out.push(id);
    }
    return out.length ? out.sort().join(",") : "";
  })
    .split(",")
    .filter(Boolean);
}

const EMPTY = "";
