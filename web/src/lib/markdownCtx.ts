import { createContext, useContext, useMemo, useRef } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { emojiUrl } from "@/api/users";
import type { Channel, PublicUser } from "@/api/types";
import type { RenderCtx } from "@/markdown/ast";
import { useChannels } from "@/stores/channels";
import { openProfilePopout } from "@/stores/profilePopout";
import { useUsers } from "@/stores/users";
import { useServers, type ServerState } from "@/stores/servers";

type Roles = NonNullable<RenderCtx["roles"]>;

const NONE = {};

/**
 * A store read that only changes when what the renderer uses changes.
 *
 * A message in any channel moves that channel's last message, a profile
 * fetched for anyone replaces the people map, and a member update replaces
 * the servers; each made a new context, and every message on screen rendered
 * its markdown again for a change it cannot show. The previous value is kept
 * while `same` says nothing that matters moved, the way zustand's useShallow
 * keeps its own.
 */
function useStable<S, T>(useStore: <U>(pick: (s: S) => U) => U, pick: (s: S) => T, same: (a: T, b: T) => boolean): T {
  const last = useRef<{ value: T } | null>(null);
  return useStore((s) => {
    const next = pick(s);
    const prev = last.current;
    if (prev && (prev.value === next || same(prev.value, next))) return prev.value;
    last.current = { value: next };
    return next;
  });
}

/** Two maps with the same keys whose entries agree on what `field` picks out. */
function sameBy<T>(field: (x: T) => unknown): (a: Record<string, T>, b: Record<string, T>) => boolean {
  return (a, b) => {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const k of keys) {
      const x = a[k];
      const y = b[k];
      if (x === y) continue;
      if (x === undefined || y === undefined) return false;
      const fx = field(x);
      const fy = field(y);
      if (Array.isArray(fx) && Array.isArray(fy) ? fx.some((v, i) => v !== fy[i]) : fx !== fy) return false;
    }
    return true;
  };
}

// what a mention shows of each: a person's names, a channel's name and icon, a role's name and colour
const sameUsers = sameBy<PublicUser>((u) => [u.display_name, u.username]);
const sameChannels = sameBy<Channel>((c) => [c.name, c.glyph ?? ""]);
const sameRoles = sameBy<Roles[string]>((r) => [r.name, r.color]);

function rolesOf(servers: Record<string, ServerState>): Roles {
  const roles: Roles = {};
  for (const st of Object.values(servers)) for (const r of Object.values(st.roles)) roles[r.id] = { name: r.id === st.server.id ? "everyone" : r.name, color: r.color };
  return roles;
}

/**
 * The context, built from the stores — or, with `enabled` false, not built and
 * subscribed to nothing, so a component that has one handed down does not
 * re-render every time any user, channel or server anywhere changes.
 */
function useBuiltCtx(enabled: boolean, serverId?: string | null): RenderCtx | null {
  const users = useStable(useUsers, (u) => (enabled ? u.byId : (NONE as typeof u.byId)), sameUsers);
  const channels = useStable(useChannels, (c) => (enabled ? c.byId : (NONE as typeof c.byId)), sameChannels);
  const roles = useStable(useServers, (st) => (enabled ? rolesOf(st.byId) : (NONE as Roles)), sameRoles);
  // The router's history, which stays the same from page to page. useNavigate
  // would re-render every message on the screen each time the address changes.
  // (none outside a router — a list rendered on its own in a test)
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;
  return useMemo<RenderCtx | null>(() => {
    if (!enabled) return null;
    return {
      users,
      channels,
      roles,
      emojiUrl,
      onUserClick: (id, el) => openProfilePopout(id, el, serverId ?? undefined),
      onChannelClick: (id) => {
        // read when clicked: the map above is only kept current for names
        const ch = useChannels.getState().byId[id];
        if (!ch || ch.type === "category") return;
        navigator?.push(ch.server_id ? `/channels/${ch.server_id}/${ch.id}` : `/channels/@me/${ch.id}`);
      },
    };
  }, [enabled, users, channels, roles, serverId, navigator]);
}

/**
 * Render context for markdown: names for mentions, emoji urls, role colours,
 * click handlers. `serverId` is the server the text is read in, whose roles a
 * mentioned person's popout shows.
 */
export function useRenderCtx(serverId?: string | null): RenderCtx {
  return useBuiltCtx(true, serverId)!;
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
