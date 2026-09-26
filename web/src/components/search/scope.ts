/**
 * Where a search looks, and what everything in it is called.
 *
 * The search box above a conversation looks in that conversation: a DM or a
 * group with the side conversations inside it (a subchat is a room of the
 * conversation, not a separate one), or every channel of a server. The global
 * search looks everywhere. Names are worked out here once for the chips, the
 * suggestions and the result rows, so they all say the same thing.
 */
import { useMemo } from "react";
import type { Channel, PublicUser } from "@/api/types";
import { t } from "@/i18n";
import type { SearchCtx } from "@/lib/search";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { searchableChannels } from "@/search/indexer";
import { useAuth } from "@/stores/auth";
import { conversationOf, selectServerChannels, selectSubchats, useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";

export type SearchScope = { kind: "all" } | { kind: "conversation"; id: string } | { kind: "server"; id: string };

export const EVERYWHERE: SearchScope = { kind: "all" };

/** The scope the search box of a channel starts in. */
export function scopeOf(channel: Channel, byId: Record<string, Channel>): SearchScope {
  if (channel.server_id) return { kind: "server", id: channel.server_id };
  const convo = conversationOf(byId, channel) ?? channel;
  return { kind: "conversation", id: convo.id };
}

/** The channels a scope covers, or null for everywhere. */
export function scopeChannels(scope: SearchScope, byId: Record<string, Channel>): string[] | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "conversation") return [scope.id, ...selectSubchats(byId, scope.id).map((c) => c.id)];
  const searchable = new Set(searchableChannels(byId).map((c) => c.id));
  return selectServerChannels(byId, scope.id).filter((c) => searchable.has(c.id)).map((c) => c.id);
}

export interface Names {
  users: Record<string, PublicUser>;
  meId: string | undefined;
  /** A person's name as this reader knows them: a friend nickname, else their display name. */
  person: (userId: string) => string;
  /** A channel as a result or a chip names it: "#general", a DM's person, a group's name. */
  channel: (ch: Channel) => string;
  /** The server a channel is in, if any. */
  serverName: (serverId: string | null) => string | null;
  /** What the query resolves names against. */
  ctx: SearchCtx;
}

/** Everything's name, kept in step with the stores. */
export function useNames(): Names {
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const byId = useChannels((c) => c.byId);
  const servers = useServers((st) => st.byId);
  const rels = useRelationships((r) => r.byUser);
  return useMemo(() => {
    const friends = friendNicknames(rels);
    const channel = (ch: Channel): string => (ch.server_id ? `#${ch.name}` : channelDisplayName(ch, users, meId, friends));
    // A person answers to their username, their display name, a friend
    // nickname and any nickname in a shared server; a conversation to what
    // it is shown as, and a DM to its person's names too.
    const nicknames: Record<string, string[]> = {};
    const add = (id: string, name: string | undefined) => {
      const n = name?.trim().toLowerCase();
      if (!n) return;
      (nicknames[id] ??= []).push(n);
    };
    for (const [id, nick] of Object.entries(friends)) add(id, nick);
    for (const st of Object.values(servers)) for (const m of Object.values(st.members)) add(m.user_id, m.nickname);
    const channelNames: Record<string, string[]> = {};
    for (const ch of searchableChannels(byId)) {
      const names = new Set<string>();
      const label = channel(ch).replace(/^#/, "").toLowerCase();
      if (label) names.add(label);
      if (ch.name) names.add(ch.name.toLowerCase());
      if (ch.type === "dm") {
        const other = ch.recipient_ids.find((id) => id !== meId);
        const u = other ? users[other] : undefined;
        if (u) {
          names.add(u.username.toLowerCase());
          names.add(u.display_name.toLowerCase());
        }
        for (const n of other ? (nicknames[other] ?? []) : []) names.add(n);
      }
      channelNames[ch.id] = [...names];
    }
    return {
      users,
      meId,
      person: (id) => friends[id] || users[id]?.display_name || users[id]?.username || t("names.unknownUser"),
      channel,
      serverName: (id) => (id ? (servers[id]?.server.name ?? null) : null),
      ctx: { users, nicknames, channelNames, ...(meId ? { meId } : {}) },
    };
  }, [users, meId, byId, servers, rels]);
}

/** The words on a scope's chip, and on the search box that searches it ("" for everywhere, which has sentences of its own). */
export function scopeName(scope: SearchScope, byId: Record<string, Channel>, names: Names): string {
  if (scope.kind === "server") return names.serverName(scope.id) ?? t("search.scope.thisServer");
  if (scope.kind === "conversation") {
    const ch = byId[scope.id];
    if (!ch) return t("search.scope.thisConversation");
    // a DM is its person, with the @ that says so
    if (ch.type === "dm") return `@${names.channel(ch)}`;
    return names.channel(ch);
  }
  return "";
}
