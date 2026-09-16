import { Crown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { servers as serversApi } from "@/api/servers";
import type { Member, PublicUser, Role } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { memberName } from "@/lib/names";
import { memberMenuItems } from "@/components/server/memberMenu";
import { useAuth } from "@/stores/auth";
import { activitiesOf, statusOf, usePresence } from "@/stores/presence";
import { StatusLine } from "@/components/activity/StatusLine";
import { useChannels } from "@/stores/channels";
import { isInstanceAdmin, memberColor, permRolesOf, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { P, compute, has, toPermMember } from "@/lib/perms";
import s from "./MemberList.module.css";

// one collator for every sort: localeCompare with options builds one per call
const nameOrder = new Intl.Collator(undefined, { sensitivity: "base" });

type Row =
  | { kind: "head"; key: string; label: string; count: number }
  | { kind: "member"; key: string; member: Member; user: PublicUser | undefined; color: string | undefined; offline: boolean };

const ROW_H = 44;
const HEAD_H = 40;
const VIRTUAL_FROM = 200;

/** Members grouped by hoisted roles, then online, then offline; windowed past 200 rows. */
export function MemberList({ serverId, channelId, drawer, open }: { serverId: string; channelId: string; drawer?: boolean; open?: boolean }) {
  const st = useServers((x) => x.byId[serverId]);
  const upsertMembers = useServers((x) => x.upsertMembers);
  const users = useUsers((u) => u.byId);
  const upsertUsers = useUsers((u) => u.upsert);
  const presence = usePresence((p) => p.byUser);
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const ref = useRef<HTMLElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const complete = st?.membersComplete ?? true;

  // large servers ship without members in ready; page them in once
  useEffect(() => {
    if (complete) return;
    let alive = true;
    (async () => {
      let after: string | undefined;
      for (let i = 0; i < 20 && alive; i++) {
        const res = await serversApi.members(serverId, { limit: 1000, ...(after ? { after } : {}) });
        if (!alive) return;
        upsertUsers(res.users);
        upsertMembers(serverId, res.members, res.members.length < 1000);
        if (res.members.length < 1000) break;
        after = res.members[res.members.length - 1]?.user_id;
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [complete, serverId, upsertMembers, upsertUsers]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Who can see the channel changes with members, roles and overwrites, not
  // presence, so it is worked out apart from the presence-driven rows below,
  // with the server's roles converted once rather than once per member.
  const overwrites = useChannels((c) => c.byId[channelId]?.overwrites);
  const visible = useMemo<Member[]>(() => {
    if (!st) return [];
    const roles = permRolesOf(st);
    const now = Date.now();
    return Object.values(st.members).filter((m) => {
      const isOwner = st.server.owner_id === m.user_id || isInstanceAdmin(m.user_id);
      return has(compute(serverId, roles, toPermMember(m, m.user_id, now), isOwner, overwrites), P.VIEW_CHANNEL);
    });
  }, [st, serverId, overwrites]);

  const rows = useMemo<Row[]>(() => {
    if (!st) return [];
    const roles = rolesByPosition(st);
    const hoisted = roles.filter((r) => r.hoist && r.id !== serverId);
    const groups = new Map<string, { label: string; members: Member[] }>();
    for (const r of hoisted) groups.set(r.id, { label: r.name, members: [] });
    const online: Member[] = [];
    const offline: Member[] = [];
    for (const m of visible) {
      const status = statusOf(presence[m.user_id]);
      if (status === "offline" || status === "invisible") {
        offline.push(m);
        continue;
      }
      let top: Role | undefined;
      for (const id of m.role_ids) {
        const r = st.roles[id];
        if (r?.hoist && (!top || r.position > top.position)) top = r;
      }
      if (top && groups.has(top.id)) groups.get(top.id)!.members.push(m);
      else online.push(m);
    }
    const byName = (a: Member, b: Member) => nameOrder.compare(memberName(a.nickname, users[a.user_id]), memberName(b.nickname, users[b.user_id]));
    const out: Row[] = [];
    const push = (key: string, label: string, list: Member[], off: boolean) => {
      if (list.length === 0) return;
      list.sort(byName);
      out.push({ kind: "head", key: "h:" + key, label, count: list.length });
      for (const m of list) out.push({ kind: "member", key: m.user_id, member: m, user: users[m.user_id], color: memberColor(st, m.user_id), offline: off });
    };
    for (const [id, g] of groups) push(id, g.label, g.members, false);
    push("online", "Online", online, false);
    push("offline", "Offline", offline, true);
    return out;
  }, [st, visible, users, presence, serverId]);

  if (!st) return null;
  const virtual = rows.length > VIRTUAL_FROM;
  let start = 0;
  let end = rows.length;
  let padTop = 0;
  let padBottom = 0;
  if (virtual) {
    const heights = rows.map((r) => (r.kind === "head" ? HEAD_H : ROW_H));
    let y = 0;
    while (start < rows.length && y + heights[start]! < scrollTop - 400) y += heights[start++]!;
    padTop = y;
    end = start;
    let y2 = y;
    while (end < rows.length && y2 < scrollTop + height + 400) y2 += heights[end++]!;
    for (let i = end; i < rows.length; i++) padBottom += heights[i]!;
  }

  const onContext = (e: MouseEvent, m: Member) => {
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items: memberMenuItems(serverId, m.user_id, { openModal }) });
  };

  return (
    <aside className={s.list} ref={ref} onScroll={(e) => virtual && setScrollTop(e.currentTarget.scrollTop)} data-testid="member-list" data-open={drawer ? !!open : undefined} aria-hidden={drawer && !open}>
      {padTop ? <div style={{ height: padTop }} /> : null}
      {rows.slice(start, end).map((row) => {
        if (row.kind === "head") {
          return (
            <div key={row.key} className={s.head}>
              {row.label} — {row.count}
            </div>
          );
        }
        const name = memberName(row.member.nickname, row.user, row.member.user_id === meId ? "You" : "Unknown User");
        const p = presence[row.member.user_id];
        return (
          <button
            key={row.key}
            className={s.row}
            data-offline={row.offline}
            onClick={() => openModal("profile", { userId: row.member.user_id })}
            onContextMenu={(e) => onContext(e, row.member)}
            data-user={row.member.user_id}
          >
            <Avatar id={row.member.user_id} avatarId={row.member.avatar_id ?? row.user?.avatar_id ?? null} name={name} size={32} status={statusOf(p)} />
            <span className={s.text}>
              <span className={s.name} style={row.color ? { color: row.color } : undefined}>
                {name}
                {st.server.owner_id === row.member.user_id ? <Crown size={14} className={s.crown} aria-label="Server Owner" /> : null}
              </span>
              {p?.status_text || p?.status_emoji || activitiesOf(p)[0] ? (
                // a custom status wins the words; what they are doing still marks the line with its own icon
                <StatusLine
                  className={s.sub}
                  testId="member-activity"
                  status={p?.status_text || p?.status_emoji ? { text: p.status_text, emoji: p.status_emoji } : null}
                  activity={activitiesOf(p)[0]}
                />
              ) : null}
            </span>
          </button>
        );
      })}
      {padBottom ? <div style={{ height: padBottom }} /> : null}
    </aside>
  );
}
