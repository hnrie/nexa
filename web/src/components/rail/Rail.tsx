import { MessageCircle, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { iconUrl } from "@/api/users";
import { Tooltip } from "@/components/common/Tooltip";
import { initials } from "@/lib/avatarColor";
import { serverUnread } from "@/lib/unread";
import { useChannels } from "@/stores/channels";
import { useReadStates, isUnread } from "@/stores/readStates";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { serverMenuItems } from "@/components/sidebar/serverMenu";
import { lastChannelOf } from "@/stores/serverNav";
import s from "./Rail.module.css";

/** Servers in the user's chosen order (settings), then join order. */
export function orderedServerIds(order: string[], positions: string[]): string[] {
  const known = new Set(order);
  const out = positions.filter((id) => known.has(id));
  for (const id of order) if (!out.includes(id)) out.push(id);
  return out;
}

/** The 72 px server rail: home (DMs), separator, servers, add. */
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
  const home = loc.pathname.startsWith("/channels/@me");
  const activeServer = loc.pathname.match(/^\/channels\/(\d+)/)?.[1];
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const railRef = useRef<HTMLElement>(null);

  let mentions = 0;
  let unread = false;
  for (const ch of Object.values(channels)) {
    if (ch.type !== "dm" && ch.type !== "group_dm") continue;
    const rs = reads[ch.id];
    mentions += rs?.mentions ?? 0;
    if (isUnread(rs, ch.last_message_id)) unread = true;
  }

  const ids = useMemo(() => orderedServerIds(order, settings.serverPositions), [order, settings.serverPositions]);

  const openServer = useCallback(
    (id: string) => {
      const last = lastChannelOf(id);
      nav(last && channels[last]?.server_id === id ? `/channels/${id}/${last}` : `/channels/${id}`);
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
    <nav className={s.rail} aria-label="Servers" ref={railRef} onDragEnd={() => { setDragId(null); setOver(null); }}>
      <div className={s.item} data-selected={home} data-unread={unread && !home}>
        <span className={s.pill} />
        <Tooltip text="Direct Messages" side="right">
          <button className={s.btn} aria-label="Direct Messages" onClick={() => nav("/channels/@me")}>
            <MessageCircle size={28} strokeWidth={2.2} />
          </button>
        </Tooltip>
        {mentions > 0 ? <span className={s.badge}>{mentions > 99 ? "99+" : mentions}</span> : null}
      </div>
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
          <button className={s.btn} aria-label="Add a Server" onClick={() => openModal("createServer")}>
            <Plus size={24} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
