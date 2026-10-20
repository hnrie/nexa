import { Crown } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { AdminHammer, OwnerCrown } from "@/components/common/OwnerBadge";
import { menuPoint } from "@/components/sidebar/ServerSidebar";
import { isOwner } from "@/lib/owner";
import { isInstanceAdmin } from "@/stores/servers";
import { StatusLine } from "@/components/activity/StatusLine";
import { friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { useTypingIn } from "@/stores/typing";
import { activitiesOf, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { groupMemberMenu } from "./groupMemberMenu";
import { groupMemberBulk } from "@/components/server/memberBulk";
import { PickBar, PickMark } from "@/components/common/Pick";
import { pickClick, usePick } from "@/stores/pick";
import { openProfilePopout } from "@/stores/profilePopout";
import { nameOrder } from "./nameOrder";
import s from "./MemberList.module.css";
import { UserTag } from "@/components/servertag/UserTag";
import { BotTag } from "@/components/apps/BotTag";

import { t } from "@/i18n";


/**
 * A group's members, drawn exactly as a server's member list: online first,
 * the owner crowned, custom status or activity underneath, and a right click
 * (or long press, or the menu key) for what you may do to each: for the
 * owner, that includes handing the group on and removing people.
 */
const NO_PICKS: string[] = [];

export function GroupMemberList({ channel, drawer, open }: { channel: Channel; drawer: boolean; open: boolean }) {
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const rels = useRelationships((r) => r.byUser);
  const me = useAuth((a) => a.me);
  // whoever types in the group shows it on their dot
  const typingOn = useSettings((x) => x.settings.typingAvatars !== false);
  const typers = useTypingIn(typingOn ? channel.id : null, me?.id);
  const openModal = useUI((u) => u.openModal);
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

  // picking several people at once (stores/pick.ts)
  const pickList = `members:${channel.id}` as const;
  const picked = usePick((p) => (p.list === pickList ? p.ids : NO_PICKS));
  const pickMode = usePick((p) => p.list === pickList && p.mode);
  const isPicking = pickMode || picked.length > 0;
  const pickOrder = useMemo(() => rows.map((r) => r.id), [rows]);
  const bulk = isPicking ? groupMemberBulk(channel.id, picked) : null;

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
            onClick={(e) => {
              // Ctrl or ⌘ picks someone, Shift a run of people, a tap one while picking
              if (pickClick(e, pickList, row.id, pickOrder)) return;
              openProfilePopout(row.id, e.currentTarget);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const pick = usePick.getState();
              if (pick.list === pickList && pick.ids.includes(row.id) && pick.ids.length > 1) {
                groupMemberBulk(channel.id, pick.ids).menu({ ...menuPoint(e), label: t("pick.count", { count: pick.ids.length }) });
                return;
              }
              if (pick.list === pickList && !pick.mode && pick.ids.length) pick.clear();
              // the menu key or Shift+F10 has no pointer: the menu opens by the row
              groupMemberMenu.open({ channelId: channel.id, userId: row.id, nav, openModal, select: pickList }, { ...menuPoint(e), label: row.name });
            }}
            data-picked={picked.includes(row.id) || undefined}
            aria-pressed={isPicking ? picked.includes(row.id) : undefined}
          >
            {isPicking ? <PickMark on={picked.includes(row.id)} label={t("pick.pickNamed", { name: row.name })} /> : null}
            <Avatar id={row.id} avatarId={users[row.id]?.avatar_id ?? null} name={row.name} size={32} status={statusOf(p)} typing={typingOn ? typers.includes(row.id) : undefined} />
            <span className={s.text}>
              <span className={s.name}>
                <span className={s.nameText}>{row.name}</span>
                {isOwner(row.id) ? <OwnerCrown /> : channel.owner_id === row.id ? <Crown size={14} className={s.crown} aria-label={t("chat.groupMemberList.groupOwner")} /> : null}
                {!isOwner(row.id) && isInstanceAdmin(row.id) ? <AdminHammer /> : null}
                <BotTag userId={row.id} />
                <UserTag userId={row.id} size="sm" />
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
      {bulk && bulk.bar.length ? (
        <div className={s.pickBar}>
          <PickBar list={pickList} count={picked.length} label={t("pick.membersBar")} actions={bulk.bar} more={bulk.menu} />
        </div>
      ) : null}
    </aside>
  );
}
