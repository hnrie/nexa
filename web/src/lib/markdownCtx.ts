import { useMemo } from "react";
import { emojiUrl } from "@/api/users";
import type { RenderCtx } from "@/markdown/ast";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useServers } from "@/stores/servers";

/** Render context for markdown: names for mentions, emoji urls, role colours, click handlers. */
export function useRenderCtx(): RenderCtx {
  const users = useUsers((u) => u.byId);
  const channels = useChannels((c) => c.byId);
  const servers = useServers((st) => st.byId);
  const openModal = useUI((u) => u.openModal);
  return useMemo<RenderCtx>(() => {
    const roles: Record<string, { name: string; color: number }> = {};
    for (const st of Object.values(servers)) for (const r of Object.values(st.roles)) roles[r.id] = { name: r.id === st.server.id ? "everyone" : r.name, color: r.color };
    return {
      users,
      channels,
      roles,
      emojiUrl,
      onUserClick: (id) => openModal("profile", { userId: id }),
    };
  }, [users, channels, servers, openModal]);
}
