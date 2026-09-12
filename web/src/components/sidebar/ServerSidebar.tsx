import { ChevronDown, ChevronRight, Hash, Lock, Plus, Settings, UserPlus, Volume2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { ApiError } from "@/api/client";
import { servers as serversApi, type ChannelPositionPatch } from "@/api/servers";
import { UserPanel } from "@/components/shell/UserPanel";
import { Tooltip } from "@/components/common/Tooltip";
import { P, isPrivateChannel } from "@/lib/perms";
import { isMuted } from "@/lib/unread";
import { channelTree, useChannels } from "@/stores/channels";
import { isUnread, useReadStates } from "@/stores/readStates";
import { canI, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { categoryMenuItems, channelMenuItems, serverMenuItems } from "./serverMenu";
import s from "./ServerSidebar.module.css";

type Drag = { id: string; kind: "channel" | "category" };
type Drop = { id: string; where: "before" | "after" | "into" };

export function ServerSidebar({ serverId }: { serverId: string }) {
  const nav = useNavigate();
  const loc = useLocation();
  const st = useServers((x) => x.byId[serverId]);
  const channels = useChannels((c) => c.byId);
  const upsert = useChannels((c) => c.upsert);
  const applyPositions = useChannels((c) => c.applyPositions);
  const reads = useReadStates((r) => r.byChannel);
  const settings = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const toast = useUI((u) => u.toast);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const headRef = useRef<HTMLButtonElement>(null);
  const active = loc.pathname.match(/^\/channels\/\d+\/(\d+)/)?.[1];
  const tree = useMemo(() => channelTree(channels, serverId), [channels, serverId]);
  const canManage = canI(st, P.MANAGE_CHANNELS);
  const collapsed = settings.collapsedCategories;

  const toggleCategory = useCallback(
    (id: string) => patch({ collapsedCategories: collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id] }),
    [collapsed, patch],
  );

  const openHeaderMenu = () => {
    if (!headRef.current) return;
    const r = headRef.current.getBoundingClientRect();
    setMenuOpen(true);
    openContextMenu({ x: r.left + 8, y: r.bottom + 4, items: serverMenuItems(serverId, { nav, openModal }) });
    const unsub = useUI.subscribe((state) => {
      if (!state.contextMenu) {
        setMenuOpen(false);
        unsub();
      }
    });
  };

  const onChannelContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items: channelMenuItems(id, { nav, openModal }) });
  };
  const onCategoryContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items: categoryMenuItems(id, { nav, openModal, collapsed: collapsed.includes(id), toggle: () => toggleCategory(id) }) });
  };

  // --- drag and drop reordering (Manage Channels only) -------------------
  const onDragStart = (e: DragEvent, d: Drag) => {
    if (!canManage) return e.preventDefault();
    setDrag(d);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", d.id);
  };
  const onDragOver = (e: DragEvent, target: Channel) => {
    if (!drag || drag.id === target.id) return;
    if (drag.kind === "category" && target.type !== "category" && !target.parent_id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    if (drag.kind === "channel" && target.type === "category") {
      setDrop({ id: target.id, where: e.clientY < r.top + r.height * 0.35 ? "before" : "into" });
      return;
    }
    setDrop({ id: target.id, where: e.clientY > r.top + r.height / 2 ? "after" : "before" });
  };
  const finish = async (list: ChannelPositionPatch[]) => {
    applyPositions(list.map((p) => ({ id: p.id, position: p.position, parent_id: p.parent_id === undefined ? (channels[p.id]?.parent_id ?? null) : p.parent_id })));
    try {
      upsert(await serversApi.setChannelPositions(serverId, list));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reorder channels.", "error");
      try {
        upsert(await serversApi.channels(serverId));
      } catch {
        /* the next event will resync */
      }
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const d = drag;
    const at = drop;
    setDrag(null);
    setDrop(null);
    if (!d || !at || d.id === at.id) return;
    const target = channels[at.id];
    const moving = channels[d.id];
    if (!target || !moving) return;
    if (d.kind === "category") {
      // categories order among themselves; a channel target maps to its parent category
      const targetCat = target.type === "category" ? target : target.parent_id ? channels[target.parent_id] : undefined;
      if (!targetCat || targetCat.id === d.id) return;
      const cats = tree.categories.map((c) => c.category).filter((c) => c.id !== d.id);
      const idx = cats.findIndex((c) => c.id === targetCat.id) + (at.where === "after" ? 1 : 0);
      cats.splice(idx, 0, moving);
      void finish(cats.map((c, i) => ({ id: c.id, position: i })));
      return;
    }
    // a channel: into a category (top), or before/after a sibling
    let parent: string | null;
    let siblings: Channel[];
    let index: number;
    if (target.type === "category") {
      parent = at.where === "into" ? target.id : null;
      siblings = parent ? (tree.categories.find((c) => c.category.id === parent)?.children ?? []) : tree.loose;
      index = at.where === "into" ? 0 : siblings.length;
    } else {
      parent = target.parent_id && channels[target.parent_id]?.type === "category" ? target.parent_id : null;
      siblings = parent ? (tree.categories.find((c) => c.category.id === parent)?.children ?? []) : tree.loose;
      index = siblings.findIndex((c) => c.id === target.id) + (at.where === "after" ? 1 : 0);
    }
    const list = siblings.filter((c) => c.id !== d.id);
    if (index > list.length) index = list.length;
    list.splice(index, 0, moving);
    void finish(list.map((c, i) => (c.id === d.id ? { id: c.id, position: i, parent_id: parent } : { id: c.id, position: i })));
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  if (!st) return <div className={s.sidebar} />;

  const renderChannel = (ch: Channel) => {
    const rs = reads[ch.id];
    const unread = ch.type === "text" && isUnread(rs, ch.last_message_id) && !isMuted(settings, ch.id, serverId);
    const mentions = rs?.mentions ?? 0;
    const selected = active === ch.id;
    const priv = isPrivateChannel(serverId, ch.overwrites);
    const muted = settings.notifications.muted.includes(ch.id);
    return (
      <div
        key={ch.id}
        className={s.row}
        data-selected={selected}
        data-unread={unread && !selected}
        data-muted={muted}
        data-drop={drop?.id === ch.id ? drop.where : undefined}
        data-dragging={drag?.id === ch.id}
        data-channel={ch.id}
        draggable={canManage}
        onDragStart={(e) => onDragStart(e, { id: ch.id, kind: "channel" })}
        onDragOver={(e) => onDragOver(e, ch)}
        onDrop={onDrop}
        onDragEnd={endDrag}
        onContextMenu={(e) => onChannelContext(e, ch.id)}
      >
        <button className={s.channel} onClick={() => nav(`/channels/${serverId}/${ch.id}`)} aria-current={selected ? "page" : undefined}>
          <span className={s.icon}>{ch.type === "voice" ? <Volume2 size={20} /> : priv ? <span className={s.lockHash}><Hash size={20} /><Lock size={10} className={s.lock} /></span> : <Hash size={20} />}</span>
          <span className={s.name}>{ch.name}</span>
        </button>
        <span className={s.actions}>
          {canI(st, P.CREATE_INSTANT_INVITE, ch.id) ? (
            <Tooltip text="Create Invite" side="top">
              <button className={s.action} aria-label="Create Invite" onClick={() => openModal("invite", { serverId, channelId: ch.id })}><UserPlus size={16} /></button>
            </Tooltip>
          ) : null}
          {canI(st, P.MANAGE_CHANNELS, ch.id) ? (
            <Tooltip text="Edit Channel" side="top">
              <button className={s.action} aria-label="Edit Channel" onClick={() => openModal("channelSettings", { channelId: ch.id })}><Settings size={16} /></button>
            </Tooltip>
          ) : null}
        </span>
        {mentions > 0 ? <span className={s.mention}>{mentions > 99 ? "99+" : mentions}</span> : null}
      </div>
    );
  };

  return (
    <div className={s.sidebar} onDrop={(e) => e.preventDefault()}>
      <button ref={headRef} className={s.head} data-open={menuOpen} onClick={openHeaderMenu} aria-haspopup="menu" aria-expanded={menuOpen}>
        <span className={s.headName}>{st.server.name}</span>
        {menuOpen ? <X size={18} /> : <ChevronDown size={18} />}
      </button>
      <div className={s.scroll}>
        <div className={s.top} />
        {tree.loose.map(renderChannel)}
        {tree.categories.map(({ category, children }) => {
          const isCollapsed = collapsed.includes(category.id);
          return (
            <div key={category.id} className={s.category} data-dragging={drag?.id === category.id}>
              <div
                className={s.catHead}
                data-drop={drop?.id === category.id ? drop.where : undefined}
                draggable={canManage}
                onDragStart={(e) => onDragStart(e, { id: category.id, kind: "category" })}
                onDragOver={(e) => onDragOver(e, category)}
                onDrop={onDrop}
                onDragEnd={endDrag}
                onContextMenu={(e) => onCategoryContext(e, category.id)}
              >
                <button className={s.catToggle} onClick={() => toggleCategory(category.id)} aria-expanded={!isCollapsed}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className={s.catName}>{category.name}</span>
                </button>
                {canManage ? (
                  <Tooltip text="Create Channel" side="top">
                    <button className={s.catAdd} aria-label="Create Channel" onClick={() => openModal("createChannel", { serverId, parentId: category.id })}><Plus size={16} /></button>
                  </Tooltip>
                ) : null}
              </div>
              {children.filter((c) => !isCollapsed || c.id === active || (isUnread(reads[c.id], c.last_message_id) && !isMuted(settings, c.id, serverId)) || (reads[c.id]?.mentions ?? 0) > 0).map(renderChannel)}
            </div>
          );
        })}
        {tree.loose.length === 0 && tree.categories.length === 0 ? <div className={s.empty}>No channels you can see yet.</div> : null}
      </div>
      <UserPanel />
    </div>
  );
}
