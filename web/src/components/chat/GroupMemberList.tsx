import { Crown } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { AdminTools, OwnerCrown } from "@/components/common/OwnerBadge";
import { menuPoint } from "@/components/sidebar/ServerSidebar";
import { isOwner } from "@/lib/owner";
import { isInstanceAdmin } from "@/stores/servers";
import { StatusLine } from "@/components/activity/StatusLine";
import { friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { activitiesOf, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { groupMemberMenuItems } from "./groupMemberMenu";
import { nameOrder } from "./nameOrder";
import s from "./MemberList.module.css";

import { t } from "@/i18n";


/**
 * A group's members, drawn exactly as a server's member list: online first,
 * the owner crowned, custom status or activity underneath, and a right click
 * (or long press, or the menu key) for what you may do to each: for the
 * owner, that includes handing the group on and removing people.
 */
export function GroupMemberList({ channel, drawer, open }: { channel: Channel; drawer: boolean; open: boolean }) {
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const rels = useRelationships((r) => r.byUser);
  const me = useAuth((a) => a.me);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const nav = useNavigate();

  const rows = useMemo(() => {
    const nicknames = friendNicknames(rels);
    return channel.recipient_ids
      .map((id) => {
        const status = statusOf(presence[id]);
        const name = nicknames[id] || displayName(users[id], id === me?.id ? me.display_name : t("names.unknownUser"));
        return { id, name, offline: status === "offline" || status === "invisible" };
      })
      .sort((a, b) => Number(a.offline) - Number(b.offline) || nameOrder().compare(a.name, b.name));
  }, [channel.recipient_ids, presence, users, rels, me]);

  return (
    <aside className={s.list} data-testid="group-member-list" data-open={drawer ? open : undefined} aria-hidden={drawer && !open} {...(drawer && !open ? ({ inert: "" } as Record<string, string>) : {})}>
      <div className={s.head}>{t("chat.groupMemberList.membersCount", { count: rows.length })}</div>
      {rows.map((row) => {
        const p = presence[row.id];
        const activity = activitiesOf(p)[0];
        return (
          <button
            key={row.id}
            className={s.row}
            data-offline={row.offline}
            data-user={row.id}
            onClick={() => openModal("profile", { userId: row.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              // the menu key or Shift+F10 has no pointer: the menu opens by the row
              openContextMenu({ ...menuPoint(e), label: row.name, items: groupMemberMenuItems(channel.id, row.id, { nav, openModal }) });
            }}
          >
            <Avatar id={row.id} avatarId={users[row.id]?.avatar_id ?? null} name={row.name} size={32} status={statusOf(p)} />
            <span className={s.text}>
              <span className={s.name}>
                {row.name}
                {isOwner(row.id) ? <OwnerCrown /> : channel.owner_id === row.id ? <Crown size={14} className={s.crown} aria-label={t("chat.groupMemberList.groupOwner")} /> : null}
                {!isOwner(row.id) && isInstanceAdmin(row.id) ? <AdminTools /> : null}
              </span>
              <StatusLine
                className={s.sub}
                status={p?.status_text || p?.status_emoji ? { text: p.status_text, emoji: p.status_emoji } : null}
                activity={activity}
                more={Math.max(0, activitiesOf(p).length - 1)}
              />
            </span>
          </button>
        );
      })}
    </aside>
  );
}
