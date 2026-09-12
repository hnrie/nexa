import { Plus, Users } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { UserPanel } from "@/components/shell/UserPanel";
import { VoiceStatus } from "@/components/voice/VoiceStatus";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { selectDMs, useChannels } from "@/stores/channels";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { isUnread, useReadStates } from "@/stores/readStates";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useRelationships } from "@/stores/relationships";
import { useMemo } from "react";
import { iconUrl } from "@/api/users";
import s from "./Sidebar.module.css";

export function DMSidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const reads = useReadStates((r) => r.byChannel);
  const openModal = useUI((u) => u.openModal);
  const setQuickSwitcher = useUI((u) => u.setQuickSwitcher);
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const dms = selectDMs(channels);
  const active = loc.pathname.match(/^\/channels\/@me\/(\d+)/)?.[1];

  return (
    <div className={s.sidebar}>
      <div className={s.search}>
        <button className={s.searchBtn} onClick={() => setQuickSwitcher(true)}>Find or start a conversation</button>
      </div>
      <div className={s.scroll}>
        <button className={s.nav} data-selected={loc.pathname === "/channels/@me"} onClick={() => nav("/channels/@me")}>
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
          const mentions = rs?.mentions ?? 0;
          let sub = "";
          let avatar: React.ReactNode;
          if (ch.type === "dm") {
            const other = ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0] ?? "";
            const u = users[other];
            const st = customStatus(presence[other]);
            sub = st ? `${st.emoji ? st.emoji + " " : ""}${st.text}` : "";
            avatar = <Avatar id={other} avatarId={u?.avatar_id ?? null} name={name} size={32} status={statusOf(presence[other])} />;
          } else {
            sub = `${ch.recipient_ids.length} Members`;
            const url = iconUrl(ch.icon_id);
            avatar = url ? <Avatar id={ch.id} avatarId={ch.icon_id} name={name} size={32} /> : <span className={s.groupIcon}><Users size={18} /></span>;
          }
          return (
            <button key={ch.id} className={s.item} data-selected={active === ch.id} data-unread={unread && active !== ch.id} onClick={() => nav(`/channels/@me/${ch.id}`)}>
              {avatar}
              <span className={s.text}>
                <span className={s.name}>{name}</span>
                {sub ? <span className={s.sub}>{sub}</span> : null}
              </span>
              {mentions > 0 ? <span className={s.mention}>{mentions > 99 ? "99+" : mentions}</span> : null}
            </button>
          );
        })}
      </div>
      <VoiceStatus />
      <UserPanel />
    </div>
  );
}
