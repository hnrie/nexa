import { MessageCircle, Plus, Users, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { UserPanel } from "@/components/shell/UserPanel";
import { VoiceStatus } from "@/components/voice/VoiceStatus";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { selectDMs, selectSubchats, useChannels } from "@/stores/channels";
import { activitiesOf, customStatus, statusOf, usePresence } from "@/stores/presence";
import { StatusLine } from "@/components/activity/StatusLine";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useRelationships } from "@/stores/relationships";
import { useMemo } from "react";
import { iconUrl } from "@/api/users";
import { subchatMenuItems } from "@/components/chat/SubchatPanel";
import { badgeText, conversationCount } from "@/lib/unread";
import { useSettings } from "@/stores/settings";
import { closeDM, dmMenuItems } from "./dmMenu";
import s from "./Sidebar.module.css";

export function DMSidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const reads = useReadStates((r) => r.byChannel);
  const settings = useSettings((st) => st.settings);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const setQuickSwitcher = useUI((u) => u.setQuickSwitcher);
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const dms = selectDMs(channels);
  const active = loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];
  // A subchat keeps its conversation highlighted, with its siblings listed
  // underneath, so you can see where you are.
  const activeChannel = active ? channels[active] : undefined;
  const activeConvo = activeChannel?.type === "subchat" ? (activeChannel.parent_id ?? undefined) : active;
  // Picking something closes the phone drawer, even the page already open,
  // which navigating to the same address would not.
  const go = (path: string) => {
    nav(path);
    useUI.getState().setLeftOpen(false);
  };

  return (
    <div className={s.sidebar}>
      <div className={s.search}>
        <button className={s.searchBtn} onClick={() => setQuickSwitcher(true)}>Find or start a conversation</button>
      </div>
      <div className={s.scroll}>
        <button className={s.nav} data-selected={loc.pathname === "/channels/@me"} onClick={() => go("/channels/@me")}>
          <span className={s.navIcon}><Users size={22} /></span>
          <span>Friends</span>
        </button>
        <div className={s.header}>
          <span>Direct Messages</span>
          <button className={s.headerBtn} aria-label="Create DM" title="Create DM" onClick={() => openModal("createDM")}>
            <Plus size={16} />
          </button>
        </div>
        {dms.length === 0 ? <div className={s.empty}>No conversations yet. Add a friend to start one.</div> : null}
        {dms.map((ch) => {
          const name = channelDisplayName(ch, users, meId, nicknames);
          const rs = reads[ch.id];
          const unread = isUnread(rs, ch.last_message_id);
          // how many messages wait here; the open conversation is being read
          const count = active === ch.id ? 0 : conversationCount(ch, rs, settings);
          let sub: React.ReactNode = null;
          let avatar: React.ReactNode;
          if (ch.type === "dm") {
            const other = ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0] ?? "";
            const u = users[other];
            const st = customStatus(presence[other]);
            const act = activitiesOf(presence[other])[0];
            sub = <StatusLine className={s.sub} status={st} activity={act} />;
            avatar = <Avatar id={other} avatarId={u?.avatar_id ?? null} name={name} size={32} status={statusOf(presence[other])} />;
          } else {
            sub = <span className={s.sub}>{`${ch.recipient_ids.length} Members`}</span>;
            const url = iconUrl(ch.icon_id, 32);
            avatar = url ? <Avatar id={ch.id} avatarId={ch.icon_id} name={name} size={32} kind="icon" /> : <span className={s.groupIcon}><Users size={18} /></span>;
          }
          const subs = activeConvo === ch.id ? selectSubchats(channels, ch.id) : [];
          return (
            <div key={ch.id}>
            <button
              className={s.item}
              data-selected={active === ch.id}
              data-parent-selected={activeConvo === ch.id && active !== ch.id}
              data-unread={unread && active !== ch.id}
              data-channel={ch.id}
              onClick={() => go(`/channels/@me/${ch.id}`)}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({ x: e.clientX, y: e.clientY, items: dmMenuItems(ch.id, { nav, openModal }) });
              }}
            >
              {avatar}
              <span className={s.text}>
                <span className={s.name}>{name}</span>
                {sub}
              </span>
              {count > 0 ? <span className={s.mention} data-testid="dm-unread" aria-label={`${count > 99 ? "more than 99" : count} unread`}>{badgeText(count)}</span> : null}
              <span
                className={s.close}
                role="button"
                aria-label="Close DM"
                title={ch.type === "group_dm" ? "Leave group" : "Close DM"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ch.type === "group_dm") openContextMenu({ x: e.clientX, y: e.clientY, items: dmMenuItems(ch.id, { nav, openModal }) });
                  else void closeDM(ch.id, nav);
                }}
              >
                <X size={16} />
              </span>
            </button>
            {subs.map((sub) => {
              const srs = reads[sub.id];
              return (
                <button
                  key={sub.id}
                  className={s.subItem}
                  data-selected={active === sub.id}
                  data-unread={isUnread(srs, sub.last_message_id) && active !== sub.id}
                  data-channel={sub.id}
                  onClick={() => go(`/channels/@me/${sub.id}`)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu({ x: e.clientX, y: e.clientY, items: subchatMenuItems(sub, { openModal, nav }) });
                  }}
                >
                  <MessageCircle size={15} />
                  <span className={s.name}>{sub.name}</span>
                  {(srs?.mentions ?? 0) > 0 ? <span className={s.mention}>{srs?.mentions}</span> : null}
                </button>
              );
            })}
            </div>
          );
        })}
      </div>
      <VoiceStatus />
      <UserPanel />
    </div>
  );
}
