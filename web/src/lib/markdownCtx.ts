import { createContext, useContext, useMemo } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { emojiUrl } from "@/api/users";
import type { RenderCtx } from "@/markdown/ast";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useServers } from "@/stores/servers";

const NONE = {};

/**
 * The context, built from the stores — or, with `enabled` false, not built and
 * subscribed to nothing, so a component that has one handed down does not
 * re-render every time any user, channel or server anywhere changes.
 */
function useBuiltCtx(enabled: boolean): RenderCtx | null {
  const users = useUsers((u) => (enabled ? u.byId : NONE)) as ReturnType<typeof useUsers.getState>["byId"];
  const channels = useChannels((c) => (enabled ? c.byId : NONE)) as ReturnType<typeof useChannels.getState>["byId"];
  const servers = useServers((st) => (enabled ? st.byId : NONE)) as ReturnType<typeof useServers.getState>["byId"];
  const openModal = useUI((u) => u.openModal);
  // The router's history, which stays the same from page to page. useNavigate
  // would re-render every message on the screen each time the address changes.
  // (none outside a router — a list rendered on its own in a test)
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;
  return useMemo<RenderCtx | null>(() => {
    if (!enabled) return null;
    const roles: Record<string, { name: string; color: number }> = {};
    for (const st of Object.values(servers)) for (const r of Object.values(st.roles)) roles[r.id] = { name: r.id === st.server.id ? "everyone" : r.name, color: r.color };
    return {
      users,
      channels,
      roles,
      emojiUrl,
      onUserClick: (id) => openModal("profile", { userId: id }),
      onChannelClick: (id) => {
        const ch = channels[id];
        if (!ch || ch.type === "category") return;
        navigator?.push(ch.server_id ? `/channels/${ch.server_id}/${ch.id}` : `/channels/@me/${ch.id}`);
      },
    };
  }, [enabled, users, channels, servers, openModal, navigator]);
}

/** Render context for markdown: names for mentions, emoji urls, role colours, click handlers. */
export function useRenderCtx(): RenderCtx {
  return useBuiltCtx(true)!;
}

const Shared = createContext<RenderCtx | null>(null);

/** Hands one render context down to every row of a list. */
export const RenderCtxProvider = Shared.Provider;

/**
 * The render context for one row of a list: the list's, when it provides one
 * (one set of subscriptions for the whole list — each row subscribing on its
 * own re-rendered every loaded message whenever a message arrived anywhere),
 * or its own outside one.
 */
export function useRowRenderCtx(): RenderCtx {
  const shared = useContext(Shared);
  const own = useBuiltCtx(shared === null);
  return (shared ?? own)!;
}
