import { Ban, Clock, Crown, Shield, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { TextInput } from "@/components/common/TextInput";
import { memberName } from "@/lib/names";
import { P } from "@/lib/perms";
import { formatFull } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import { outranks } from "../memberMenu";
import s from "../ServerSettings.module.css";
import r from "../RoleChips.module.css";

import { t } from "@/i18n";
const PAGE = 50;

export default function MembersPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const upsertMembers = useServers((x) => x.upsertMembers);
  const users = useUsers((u) => u.byId);
  const upsertUsers = useUsers((u) => u.upsert);
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const complete = server?.membersComplete ?? true;

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
        <TextInput value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder={t("server.channelSettings.searchMembers")} />
      </div>
      {rows.slice(0, shown).map(({ m, name, username }) => {
        const above = m.user_id !== meId && outranks(serverId, m.user_id);
        const timedOut = !!m.timeout_until && m.timeout_until > Date.now();
        return (
          <div key={m.user_id} className={s.memberRow} data-member={m.user_id}>
            <Avatar id={m.user_id} avatarId={m.avatar_id ?? users[m.user_id]?.avatar_id ?? null} name={name} size={40} />
            <div className={s.memberText}>
              <span className={s.memberName}>
                {name}
                {server.server.owner_id === m.user_id ? <Crown size={14} style={{ color: "var(--warning)" }} aria-label={t("server.members.owner")} /> : null}
                {timedOut ? <Clock size={14} style={{ color: "var(--danger)" }} aria-label={t("server.members.timedOut")} /> : null}
              </span>
              <span className={s.memberSub}>@{username} · joined {formatFull(m.joined_at)}</span>
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
                {canRoles && (above || m.user_id === meId) ? <button className={r.chip} onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "roles" })}>+</button> : null}
              </span>
            </div>
            <div className={s.memberActions}>
              {canRoles && (above || m.user_id === meId) ? <button title={t("server.members.roles")} aria-label={t("server.members.editRoles")} onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "roles" })}><Shield size={18} /></button> : null}
              {canTimeout && above ? <button title={timedOut ? "Remove timeout" : "Timeout"} aria-label={t("server.members.timeout")} data-danger="true" onClick={() => openModal("memberAction", { serverId, userId: m.user_id, action: "timeout" })}><Clock size={18} /></button> : null}
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
