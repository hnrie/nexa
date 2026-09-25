import { Pin, Plus, Shield, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { iconUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { NexaMark } from "@/components/common/Brand";
import { Tooltip } from "@/components/common/Tooltip";
import { useReorder } from "@/hooks/useReorder";
import { initials } from "@/lib/avatarColor";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { entryId, moveEntry, resolveRail, siblingIds, dropEntry, type RailDrop, type RailEntry, type ServerFolder } from "@/lib/railLayout";
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
import { nexaListed } from "@/components/sidebar/dmArrange";
import { serverMenuItems } from "@/components/sidebar/serverMenu";
import { menuPoint } from "@/components/sidebar/ServerSidebar";
import { lastChannelOf } from "@/stores/serverNav";
import { useNexa } from "@/stores/nexa";
import { useModeration } from "@/stores/moderation";
import { FolderFace } from "./FolderFace";
import { adoptRail, changeRail, folderMenuItems, folderName, serverArrangeItems, toggleFolder } from "./railActions";
import s from "./Rail.module.css";

import { t } from "@/i18n";

/** What Home's badge counts, read out: "3 unread messages and 1 friend request". */
export function homeLabel(messages: number, requests: number): string {
  const parts: string[] = [];
  if (messages > 0) parts.push(t("rail.rail.unreadMessagesCount", { count: messages }));
  if (requests > 0) parts.push(t("rail.rail.friendRequestsCount", { count: requests }));
  if (parts.length === 2) return t("rail.rail.and", { first: parts[0]!, second: parts[1]! });
  return parts.join("");
}

/** How many waiting conversations the rail shows under home; the DM list has the rest. */
const MAX_WAITING = 10;

/** What is being dragged: a server, or a whole folder. */
type Drag = { id: string; folder: boolean };
/** What a dragged thing is over: a server on its own, one in an open folder, or a folder's own tile. */
type Target = "server" | "inFolder" | "folder" | "openFolder";

/**
 * Where on an entry a drop lands, from how far down it the pointer is. A
 * server's middle makes a folder of the two and a folder's middle takes the
 * server in; the edges put it before or after. Among a folder's servers, and
 * for a folder being dragged, there are only the two halves.
 */
export function dropZone(drag: Drag, target: Target, y: number): RailDrop["where"] {
  if (drag.folder || target === "inFolder") return y < 0.5 ? "before" : "after";
  if (target === "openFolder") return y < 0.25 ? "before" : "combine";
  return y < 0.25 ? "before" : y > 0.75 ? "after" : "combine";
}

/**
 * The 72 px server rail: home (DMs), the conversations with messages waiting,
 * separator, the pinned servers and folders, the rest, add.
 */
export function Rail() {
  const nav = useNavigate();
  const loc = useLocation();
  const channels = useChannels((c) => c.byId);
  const reads = useReadStates((r) => r.byChannel);
  const servers = useServers((st) => st.byId);
  const order = useServers((st) => st.order);
  const settings = useSettings((st) => st.settings);
  const loaded = useSettings((st) => st.loaded);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const home = loc.pathname.startsWith("/channels/@me");
  const activeServer = loc.pathname.match(/^\/channels\/(\d+)/)?.[1];
  const openConvo = loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<RailDrop | null>(null);
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
  // what Nexa sent waits under home, like any conversation; once its conversation is closed, only something new counts
  const nexaClosed = settings.nexaClosed;
  const nexaUnread = useNexa((n) => (n.state && nexaListed(n.state.latest, nexaClosed) ? n.state.unread : 0));
  if (nexaUnread > 0) unread = true;
  homeCount += nexaUnread;
  const isAdmin = useAuth((a) => ((a.me?.flags ?? 0) & 1) !== 0);
  const needsReply = useModeration((m) => m.counts?.needs_reply ?? 0);
  const inPanel = loc.pathname.startsWith("/channels/@admin");
  // like the people themselves waiting at the door: who sent something, and how much
  const waiting = unreadConversations(channels, reads, settings, openConvo).slice(0, MAX_WAITING);

  const layout = useMemo(() => resolveRail(settings.rail, order, settings.serverPositions), [settings.rail, order, settings.serverPositions]);
  // the order an account had before folders becomes its layout, once its settings are in
  useEffect(() => {
    if (loaded) adoptRail();
  }, [loaded]);

  const folderById = useMemo(() => {
    const m = new Map<string, ServerFolder>();
    for (const e of [...layout.pinned, ...layout.rest]) if (typeof e !== "string") m.set(e.id, e);
    return m;
  }, [layout]);

  const openServer = useCallback(
    (id: string) => {
      const last = lastChannelOf(id);
      // on phones the drawer stays open, showing this server's channels to pick from
      nav(last && channels[last]?.server_id === id ? `/channels/${id}/${last}` : `/channels/${id}`, { state: { keepDrawer: true } });
    },
    [nav, channels],
  );

  // The same moves for a keyboard and for a finger. HTML5 drag events never
  // fire on a touch screen, so the rail's order could once only be changed
  // with a mouse. Each entry moves among its own list: a folder among the
  // entries of its section, a server in a folder among that folder's servers.
  const shown = useMemo(() => [...layout.pinned, ...layout.rest].flatMap((e) => (typeof e === "string" ? [e] : [e.id, ...(e.open ? e.servers : [])])), [layout]);
  const reorder = useReorder({
    ids: shown,
    siblings: (id) => siblingIds(layout, id),
    name: (id) => servers[id]?.server.name ?? (folderById.has(id) ? folderName(folderById.get(id)!) : ""),
    move: (id, delta) => {
      const next = moveEntry(layout, id, delta);
      if (next === layout) return false;
      useSettings.getState().patch({ rail: next });
      return true;
    },
  });

  const onServerContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const items = serverMenuItems(id, { nav, openModal });
    // arranging it comes straight after Mark as read, which stays first
    items.splice(items.findIndex((i) => i.id === "read") + 1, 0, ...serverArrangeItems(id, { openModal, moves: reorder.menuItems(id) }));
    openContextMenu({ ...menuPoint(e), label: servers[id]?.server.name ?? "", items });
  };
  const onFolderContext = (e: MouseEvent, f: ServerFolder) => {
    e.preventDefault();
    openContextMenu({ ...menuPoint(e), label: folderName(f), items: folderMenuItems(f.id, { openModal, moves: reorder.menuItems(f.id) }) });
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };
  const onDragStart = (e: DragEvent, id: string, folder: boolean) => {
    e.stopPropagation();
    setDrag({ id, folder });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (e: DragEvent, id: string, target: Target, folderId?: string) => {
    if (!drag) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const where = dropZone(drag, target, (e.clientY - r.top) / Math.max(1, r.height));
    // a folder goes beside another folder, never among its servers
    const next: RailDrop = drag.folder && target === "inFolder" && folderId ? { id: folderId, where } : { id, where };
    if (next.id === drag.id) {
      // back over itself, where dropping does nothing: forget where it was over before
      if (over) setOver(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over?.id !== next.id || over.where !== next.where) setOver(next);
  };
  /** Over the space around the pinned ones' line or the add button: the end of the list above it. */
  const onDragOverEnd = (e: DragEvent, lastId: string | undefined) => {
    if (!drag || !lastId || lastId === drag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over?.id !== lastId || over.where !== "after") setOver({ id: lastId, where: "after" });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (drag && over) {
      const d = drag;
      const o = over;
      changeRail((l) => dropEntry(l, d.id, o));
    }
    endDrag();
  };
  const dropOf = (id: string) => (over?.id === id ? over.where : undefined);

  const renderServer = (id: string, folder: ServerFolder | null) => {
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
        data-drop={dropOf(id)}
        data-dragging={drag?.id === id}
        draggable
        onDragStart={(e) => onDragStart(e, id, false)}
        onDragOver={(e) => onDragOver(e, id, folder ? "inFolder" : "server", folder?.id)}
        onDrop={onDrop}
        onContextMenu={(e) => onServerContext(e, id)}
        onKeyDown={reorder.onKeyDown(id)}
        data-server={id}
        data-reorder-id={id}
      >
        <span className={s.pill} />
        <Tooltip text={st.server.name} side="right">
          <button
            className={[s.btn, url ? s.hasIcon : ""].join(" ")}
            // Home and Waiting already fold their count into the name and
            // hide the badge; the servers did neither, so a badge announced
            // itself as a loose "3".
            aria-label={u.mentions > 0 ? t("rail.rail.serverWithMentions", { name: st.server.name, count: u.mentions }) : st.server.name}
            aria-current={selected ? "page" : undefined}
            onClick={() => openServer(id)}
          >
            {url ? <img src={url} alt="" draggable={false} /> : <span className={s.initials}>{initials(st.server.name)}</span>}
          </button>
        </Tooltip>
        {u.mentions > 0 ? <span className={s.badge} aria-hidden="true">{u.mentions > 99 ? "99+" : u.mentions}</span> : null}
      </div>
    );
  };

  const renderFolder = (f: ServerFolder) => {
    const ids = f.servers.filter((id) => servers[id]);
    if (ids.length === 0) return null;
    const open = !!f.open;
    let fUnread = false;
    let mentions = 0;
    for (const id of ids) {
      const u = serverUnread(id, channels, reads, settings);
      if (u.unread) fUnread = true;
      mentions += u.mentions;
    }
    // a closed folder stands in for the server open inside it
    const holdsActive = !!activeServer && ids.includes(activeServer);
    const name = folderName(f);
    const label = t("organize.rail.folderLabel", { name, count: ids.length });
    const drop = dropOf(f.id);
    return (
      <div
        key={f.id}
        className={s.folder}
        data-open={open}
        data-drop={drop === "before" || drop === "after" ? drop : undefined}
        data-dragging={drag?.id === f.id}
        data-folder={f.id}
        style={{ "--folder": f.color ?? "var(--brand)" } as CSSProperties}
        // open, it holds its servers, and a screen reader hears where they end
        {...(open ? { role: "group", "aria-label": name } : {})}
      >
        <div
          className={[s.item, s.folderItem].join(" ")}
          data-selected={!open && holdsActive}
          data-unread={!open && fUnread && !holdsActive}
          data-drop={drop === "combine" ? "combine" : undefined}
          draggable
          onDragStart={(e) => onDragStart(e, f.id, true)}
          onDragOver={(e) => onDragOver(e, f.id, open ? "openFolder" : "folder")}
          onDrop={onDrop}
          onContextMenu={(e) => onFolderContext(e, f)}
          onKeyDown={reorder.onKeyDown(f.id)}
          data-reorder-id={f.id}
        >
          <span className={s.pill} />
          <Tooltip text={name} side="right">
            <button
              className={[s.btn, s.folderBtn].join(" ")}
              aria-expanded={open}
              aria-label={!open && mentions > 0 ? t("rail.rail.serverWithMentions", { name: label, count: mentions }) : label}
              onClick={() => toggleFolder(f)}
              data-testid="folder-button"
            >
              <FolderFace serverIds={ids} open={open} />
            </button>
          </Tooltip>
          {!open && mentions > 0 ? <span className={s.badge} aria-hidden="true">{badgeText(mentions)}</span> : null}
        </div>
        {open ? ids.map((id) => renderServer(id, f)) : null}
      </div>
    );
  };

  const renderEntry = (e: RailEntry) => (typeof e === "string" ? renderServer(e, null) : renderFolder(e));
  const lastPinned = layout.pinned.at(-1);
  const lastRest = layout.rest.at(-1);

  return (
    <nav className={s.rail} aria-label={t("rail.rail.servers")} ref={railRef} onDragEnd={endDrag}>
      {reorder.live}
      <div className={s.item} data-selected={home} data-unread={(unread || friendRequests > 0) && !home} data-testid="home">
        <span className={s.pill} />
        <Tooltip text={t("sidebar.dMSidebar.directMessages")} side="right">
          <button className={s.btn} aria-label={homeCount > 0 ? t("rail.rail.directMessagesWith", { what: homeLabel(homeCount - friendRequests, friendRequests) }) : t("sidebar.dMSidebar.directMessages")} onClick={() => nav("/channels/@me", { state: { keepDrawer: true } })}>
            <NexaMark size={30} />
          </button>
        </Tooltip>
        {homeCount > 0 ? <span className={s.badge} aria-hidden="true" data-testid="home-count">{badgeText(homeCount)}</span> : null}
      </div>
      {isAdmin ? (
        <div className={s.item} data-selected={inPanel} data-unread={needsReply > 0 && !inPanel} data-testid="rail-moderation">
          <span className={s.pill} />
          <Tooltip text={t("moderation.title")} side="right">
            <button className={s.btn} aria-label={needsReply > 0 ? t("moderation.railWithCount", { count: needsReply }) : t("moderation.title")} onClick={() => nav("/channels/@admin")}>
              <Shield size={24} />
            </button>
          </Tooltip>
          {needsReply > 0 ? <span className={s.badge} aria-hidden="true">{badgeText(needsReply)}</span> : null}
        </div>
      ) : null}
      {waiting.map(({ channel: ch, count }) => {
        const name = channelDisplayName(ch, users, meId, nicknames);
        const other = ch.type === "dm" ? (ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0] ?? "") : "";
        const label = t("rail.rail.channelUnread", { name, what: count > 99 ? t("rail.rail.moreThan99Unread") : t("rail.rail.unreadMessagesCount", { count }) });
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
      {layout.pinned.length > 0 ? (
        // named, so a screen reader hears where the pinned ones end
        <div className={s.section} role="group" aria-label={t("organize.pinned")} data-testid="rail-pinned">
          {layout.pinned.map(renderEntry)}
        </div>
      ) : null}
      {layout.pinned.length > 0 && layout.rest.length > 0 ? (
        <div className={s.pinSep} aria-hidden="true" onDragOver={(e) => onDragOverEnd(e, lastPinned ? entryId(lastPinned) : undefined)} onDrop={onDrop}>
          <Pin size={12} />
        </div>
      ) : null}
      {layout.rest.map(renderEntry)}
      <div className={[s.item, s.add].join(" ")} onDragOver={(e) => onDragOverEnd(e, lastRest ? entryId(lastRest) : undefined)} onDrop={onDrop}>
        <span className={s.pill} />
        <Tooltip text={t("rail.rail.addAServer")} side="right">
          <button className={s.btn} aria-label={t("rail.rail.addAServer")} data-testid="add-server" onClick={() => openModal("createServer")}>
            <Plus size={24} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
