import { Plus, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { iconUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { NexaMark } from "@/components/common/Brand";
import { Tooltip } from "@/components/common/Tooltip";
import { initials } from "@/lib/avatarColor";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { badgeText, conversationCount, serverUnread, unreadConversations } from "@/lib/unread";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useReadStates, isUnread } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { dmMenuItems } from "@/components/sidebar/dmMenu";
import { serverMenuItems } from "@/components/sidebar/serverMenu";
import { lastChannelOf } from "@/stores/serverNav";
import s from "./Rail.module.css";

import { t } from "@/i18n";
/** Servers in the user's chosen order (settings), then join order. */
export function orderedServerIds(order: string[], positions: string[]): string[] {
  const known = new Set(order);
  const out = positions.filter((id) => known.has(id));
  for (const id of order) if (!out.includes(id)) out.push(id);
  return out;
}

/** What Home's badge counts, read out: "3 unread messages and 1 friend request". */
export function homeLabel(messages: number, requests: number): string {
  const parts: string[] = [];
  if (messages > 0) parts.push(`${messages} unread ${messages === 1 ? "message" : "messages"}`);
  if (requests > 0) parts.push(`${requests} ${requests === 1 ? "friend request" : "friend requests"}`);
  return parts.join(" and ");
}

/** How many waiting conversations the rail shows under home; the DM list has the rest. */
const MAX_WAITING = 10;

/** The 72 px server rail: home (DMs), the conversations with messages waiting, separator, servers, add. */
export function Rail() {
  const nav = useNavigate();
  const loc = useLocation();
  const channels = useChannels((c) => c.byId);
  const reads = useReadStates((r) => r.byChannel);
  const servers = useServers((st) => st.byId);
  const order = useServers((st) => st.order);
  const settings = useSettings((st) => st.settings);
  const patch = useSettings((st) => st.patch);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const home = loc.pathname.startsWith("/channels/@me");
  const activeServer = loc.pathname.match(/^\/channels\/(\d+)/)?.[1];
  const openConvo = loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const railRef = useRef<HTMLElement>(null);

  // Home works like a server: a pill while something is waiting, and a count of
  // every message waiting in a conversation plus the friend requests to answer
  let unread = false;
  let homeCount = 0;
  for (const ch of Object.values(channels)) {
    if (ch.type !== "dm" && ch.type !== "group_dm") continue;
    if (isUnread(reads[ch.id], ch.last_message_id)) unread = true;
    homeCount += conversationCount(ch, reads[ch.id], settings);
  }
  const friendRequests = useMemo(() => Object.values(rels).filter((r) => r.type === "incoming").length, [rels]);
  homeCount += friendRequests;
  // like the people themselves waiting at the door: who sent something, and how much
  const waiting = unreadConversations(channels, reads, settings, openConvo).slice(0, MAX_WAITING);

  const ids = useMemo(() => orderedServerIds(order, settings.serverPositions), [order, settings.serverPositions]);

  const openServer = useCallback(
    (id: string) => {
      const last = lastChannelOf(id);
      // on phones the drawer stays open, showing this server's channels to pick from
      nav(last && channels[last]?.server_id === id ? `/channels/${id}/${last}` : `/channels/${id}`, { state: { keepDrawer: true } });
    },
    [nav, channels],
  );

  const onContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items: serverMenuItems(id, { nav, openModal }) });
  };

  const onDragStart = (e: DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (e: DragEvent, id: string) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver({ id, after: e.clientY > r.top + r.height / 2 });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && over && dragId !== over.id) {
      const next = ids.filter((x) => x !== dragId);
      const at = next.indexOf(over.id) + (over.after ? 1 : 0);
      next.splice(at, 0, dragId);
      patch({ serverPositions: next });
    }
    setDragId(null);
    setOver(null);
  };

  return (
    <nav className={s.rail} aria-label={t("rail.rail.servers")} ref={railRef} onDragEnd={() => { setDragId(null); setOver(null); }}>
      <div className={s.item} data-selected={home} data-unread={(unread || friendRequests > 0) && !home} data-testid="home">
        <span className={s.pill} />
        <Tooltip text="Direct Messages" side="right">
          <button className={s.btn} aria-label={homeCount > 0 ? `Direct Messages, ${homeLabel(homeCount - friendRequests, friendRequests)}` : "Direct Messages"} onClick={() => nav("/channels/@me", { state: { keepDrawer: true } })}>
            <NexaMark size={30} />
          </button>
        </Tooltip>
        {homeCount > 0 ? <span className={s.badge} aria-hidden="true" data-testid="home-count">{badgeText(homeCount)}</span> : null}
      </div>
      {waiting.map(({ channel: ch, count }) => {
        const name = channelDisplayName(ch, users, meId, nicknames);
        const other = ch.type === "dm" ? (ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0] ?? "") : "";
        const label = `${name}, ${count > 99 ? "more than 99" : count} unread ${count === 1 ? "message" : "messages"}`;
        return (
          <div key={ch.id} className={[s.item, s.waiting].join(" ")} data-unread="true" data-waiting={ch.id}>
            <span className={s.pill} />
            <Tooltip text={name} side="right">
              <button
                className={[s.btn, s.hasIcon].join(" ")}
                aria-label={label}
                onClick={() => {
                  nav(`/channels/@me/${ch.id}`);
                  useUI.getState().setLeftOpen(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu({ x: e.clientX, y: e.clientY, items: dmMenuItems(ch.id, { nav, openModal }) });
                }}
              >
                {ch.type === "dm" ? (
                  <Avatar id={other} avatarId={users[other]?.avatar_id ?? null} name={name} size={48} />
                ) : ch.icon_id ? (
                  <Avatar id={ch.id} avatarId={ch.icon_id} name={name} size={48} kind="icon" />
                ) : (
                  <span className={s.groupIcon}><Users size={24} /></span>
                )}
              </button>
            </Tooltip>
            <span className={s.badge} aria-hidden="true" data-testid="waiting-count">{badgeText(count)}</span>
          </div>
        );
      })}
      <div className={s.sep} />
      {ids.map((id) => {
        const st = servers[id];
        if (!st) return null;
        const url = iconUrl(st.server.icon_id, 48);
        const u = serverUnread(id, channels, reads, settings);
        const selected = activeServer === id;
        const muted = settings.notifications.muted.includes(id);
        return (
          <div
            key={id}
            className={[s.item, s.server].join(" ")}
            data-selected={selected}
            data-unread={u.unread && !selected}
            data-muted={muted}
            data-drop={over?.id === id ? (over.after ? "after" : "before") : undefined}
            data-dragging={dragId === id}
            draggable
            onDragStart={(e) => onDragStart(e, id)}
            onDragOver={(e) => onDragOver(e, id)}
            onDrop={onDrop}
            onContextMenu={(e) => onContext(e, id)}
            data-server={id}
          >
            <span className={s.pill} />
            <Tooltip text={st.server.name} side="right">
              <button className={[s.btn, url ? s.hasIcon : ""].join(" ")} aria-label={st.server.name} onClick={() => openServer(id)}>
                {url ? <img src={url} alt="" draggable={false} /> : <span className={s.initials}>{initials(st.server.name)}</span>}
              </button>
            </Tooltip>
            {u.mentions > 0 ? <span className={s.badge}>{u.mentions > 99 ? "99+" : u.mentions}</span> : null}
          </div>
        );
      })}
      <div className={[s.item, s.add].join(" ")}>
        <span className={s.pill} />
        <Tooltip text="Add a Server" side="right">
          <button className={s.btn} aria-label={t("rail.rail.addAServer")} onClick={() => openModal("createServer")}>
            <Plus size={24} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
