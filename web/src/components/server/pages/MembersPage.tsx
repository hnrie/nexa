import { PersonName } from "@/components/common/PersonName";
import { Ban, Clock, Crown, Shield, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import { Avatar } from "@/components/common/Avatar";
import { RankMark } from "@/components/common/OwnerBadge";
import { isOwner } from "@/lib/owner";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { TextInput } from "@/components/common/TextInput";
import { NoMatches } from "../NoMatches";
import { memberName } from "@/lib/names";
import { P } from "@/lib/perms";
import { formatDateDivider } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import { outranks } from "../memberMenu";
import s from "../ServerSettings.module.css";
import r from "../RoleChips.module.css";

import { t } from "@/i18n";
import { ModMembers } from "./members/ModMembers";
const PAGE = 50;

/** Moderators get the Members page with its filters and Mod View; everyone else the plain list. */
export default function MembersPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const moderator = [P.MANAGE_SERVER, P.MANAGE_ROLES, P.MANAGE_NICKNAMES, P.KICK_MEMBERS, P.BAN_MEMBERS, P.MODERATE_MEMBERS].some((p) => canI(server, p));
  return moderator ? <ModMembers serverId={serverId} /> : <PlainMembers serverId={serverId} />;
}

function PlainMembers({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const upsertMembers = useServers((x) => x.upsertMembers);
  const users = useUsers((u) => u.byId);
  const upsertUsers = useUsers((u) => u.upsert);
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  // Up to twenty sequential requests run behind this list. If one of them
  // fails the list simply stops growing, and a moderator searching for someone
  // who is not in the part that arrived concludes they are not a member.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const complete = server?.membersComplete ?? true;
  // A server past the twenty thousand members this page reads through is
  // shown in part, and says so; a search asks the server for the rest.
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    if (complete) return;
    let alive = true;
    setFailed(false);
    (async () => {
      let after: string | undefined;
      for (let i = 0; i < 20 && alive; i++) {
        const res = await serversApi.members(serverId, { limit: 1000, ...(after ? { after } : {}) });
        if (!alive) return;
        upsertUsers(res.users);
        upsertMembers(serverId, res.members, res.members.length < 1000);
        if (res.members.length < 1000) return;
        after = res.members[res.members.length - 1]?.user_id;
      }
      if (alive) setCapped(true);
    })().catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [complete, serverId, upsertMembers, upsertUsers, attempt]);

  // with the list incomplete, a search also asks the server, which searches them all
  useEffect(() => {
    const query = q.trim();
    if (complete || query.length < 2) return;
    let alive = true;
    const h = setTimeout(() => {
      void serversApi
        .members(serverId, { q: query, limit: 100 })
        .then((res) => {
          if (!alive) return;
          upsertUsers(res.users);
          upsertMembers(serverId, res.members, false);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, complete, serverId, upsertMembers, upsertUsers]);

  const rows = useMemo(() => {
    if (!server) return [];
    const query = q.trim().toLowerCase();
    return Object.values(server.members)
      .map((m) => ({ m, name: memberName(m.nickname, users[m.user_id]), username: users[m.user_id]?.username ?? "" }))
      .filter((x) => !query || x.name.toLowerCase().includes(query) || x.username.includes(query))
      .sort((a, b) => a.m.joined_at - b.m.joined_at);
  }, [server, users, q]);

  if (!server) return null;
  const canKick = canI(server, P.KICK_MEMBERS);
  const canBan = canI(server, P.BAN_MEMBERS);
  const canTimeout = canI(server, P.MODERATE_MEMBERS);
  const canRoles = canI(server, P.MANAGE_ROLES);
  return (
    <>
      <h2 className={st.title}>{t("server.members.membersCount", { count: server.memberCount })}</h2>
      <div className={s.searchRow}>
        <TextInput value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder={t("server.channelSettings.searchMembers")} aria-label={t("server.channelSettings.searchMembers")} />
      </div>
      {failed ? <LoadError message={t("server.members.notEveryMemberCouldBeLoaded")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {!complete && !failed ? <p className={st.hint} role="status">{capped ? t("server.members.showingFirstMembers") : t("server.members.stillLoadingTheRestOfThe")}</p> : null}
      {rows.length === 0 && q.trim() && (complete || failed) ? <NoMatches people query={q} onClear={() => setQ("")} /> : null}
      {rows.slice(0, shown).map(({ m, name, username }) => {
        const above = m.user_id !== meId && outranks(serverId, m.user_id);
        const timedOut = !!m.timeout_until && m.timeout_until > Date.now();
        return (
          <div key={m.user_id} className={s.memberRow} data-member={m.user_id}>
            <Avatar id={m.user_id} avatarId={m.avatar_id ?? users[m.user_id]?.avatar_id ?? null} name={name} size={40} />
            <div className={s.memberText}>
              <span className={s.memberName}>
                <PersonName userId={m.user_id} serverId={serverId}>{name}</PersonName>
                {server.server.owner_id === m.user_id && !isOwner(m.user_id) ? <Crown size={14} style={{ color: "var(--warning)" }} aria-label={t("server.members.owner")} /> : null}
                <RankMark userId={m.user_id} />
                {timedOut ? <Clock size={14} style={{ color: "var(--danger)" }} aria-label={t("server.members.timedOut")} /> : null}
              </span>
              <span className={s.memberSub}><bdi>@{username}</bdi> · {t("server.members.joinedOn", { when: formatDateDivider(m.joined_at) })}</span>
              <span className={r.chips}>
                {m.role_ids.map((id) => {
                  const ro = server.roles[id];
                  if (!ro) return null;
                  return (
                    <span key={id} className={r.chip}>
                      <span className={r.chipDot} style={{ background: ro.color ? `#${ro.color.toString(16).padStart(6, "0")}` : "var(--text-muted)" }} />
                      {ro.name}
                    </span>
                  );
                })}
                {/* "+" alone was all a screen reader had to say for it */}
                {canRoles && (above || m.user_id === meId) ? <button className={r.chip} title={t("server.channelSettings.addRole")} aria-label={t("server.channelSettings.addRole")} onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "roles" })}>+</button> : null}
              </span>
            </div>
            <div className={s.memberActions}>
              {canRoles && (above || m.user_id === meId) ? <button title={t("server.members.roles")} aria-label={t("server.members.editRoles")} onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "roles" })}><Shield size={18} /></button> : null}
              {canTimeout && above ? <button title={timedOut ? t("server.members.removeTimeout") : t("server.members.timeout")} aria-label={t("server.members.timeout")} data-danger="true" onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "timeout" })}><Clock size={18} /></button> : null}
              {canKick && above ? <button title={t("server.members.kick")} aria-label={t("server.members.kick")} data-danger="true" onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "kick" })}><UserMinus size={18} /></button> : null}
              {canBan && above ? <button title={t("server.members.ban")} aria-label={t("server.members.ban")} data-danger="true" onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "ban" })}><Ban size={18} /></button> : null}
            </div>
          </div>
        );
      })}
      {rows.length > shown ? <div className={s.loadMore}><Button variant="secondary" size="sm" onClick={() => setShown((v) => v + PAGE)}>{t("server.members.showMoreLeft", { count: rows.length - shown })}</Button></div> : null}
    </>
  );
}
