import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Role } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { memberName } from "@/lib/names";
import { canManageRole, parsePerm, permString } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { memberHighest, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import { RoleGrid } from "../PermissionGrid";
import { SaveBar } from "../SettingsLayer";
import { rolePositionsAfterDrop } from "./rolePositions";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
const SWATCHES = [0x1abc9c, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe91e63, 0xf1c40f, 0xe67e22, 0xe74c3c, 0x95a5a6, 0x607d8b, 0x11806a, 0x1f8b4c, 0x206694, 0x71368a, 0xad1457, 0xc27c0e, 0xa84300, 0x992d22, 0x979c9f, 0x546e7a];

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

export default function RolesPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const upsertRole = useServers((x) => x.upsertRole);
  const upsertRoles = useServers((x) => x.upsertRoles);
  const removeRole = useServers((x) => x.removeRole);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const roles = useMemo(() => rolesByPosition(server), [server]);
  const [selected, setSelected] = useState<string>(roles[0]?.id ?? serverId);
  const [tab, setTab] = useState<"display" | "permissions" | "members">("display");
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const role = server?.roles[selected] ?? server?.roles[serverId];
  const mine = server && meId ? memberHighest(server, meId) : { highest: 0, isOwner: false };
  const editable = !!role && (role.id === serverId || canManageRole(mine.highest, mine.isOwner, role.position));

  useEffect(() => {
    if (server && !server.roles[selected]) setSelected(serverId);
  }, [server, selected, serverId]);

  if (!server || !role) return null;
  // @everyone has no member list to manage, however it got selected
  const view = tab === "members" && role.id === serverId ? "display" : tab;
  const memberCount = (id: string) => (id === serverId ? server.memberCount : Object.values(server.members).filter((m) => m.role_ids.includes(id)).length);

  const create = async () => {
    setBusy(true);
    try {
      const r = await serversApi.createRole(serverId, { name: "new role" });
      upsertRoles(serverId, await serversApi.roles(serverId));
      setSelected(r.id);
      setTab("display");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.roles.couldNotCreateTheRole"), "error");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const d = drag;
    const at = drop;
    setDrag(null);
    setDrop(null);
    if (!d || !at) return;
    const positions = rolePositionsAfterDrop(roles.filter((r) => r.id !== serverId), d, at.id, at.after, mine.highest, mine.isOwner);
    if (!positions) return;
    try {
      upsertRoles(serverId, await serversApi.setRolePositions(serverId, positions));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.roles.couldNotReorderRoles"), "error");
    }
  };

  return (
    <>
      <h2 className={st.title}>{t("server.members.roles")}</h2>
      <p className={st.hint}>{t("server.roles.useRolesToGroupYourMembers")}</p>
      <div className={s.rolesLayout}>
        <div className={s.roleList}>
          <Button size="sm" variant="secondary" onClick={() => void create()} loading={busy} style={{ marginBottom: 8 }} data-testid="create-role"><Plus size={14} /> {t("server.roles.createRole")}</Button>
          {roles.map((r) => {
            const canDrag = r.id !== serverId && canManageRole(mine.highest, mine.isOwner, r.position);
            return (
              <button
                key={r.id}
                className={s.roleRow}
                data-selected={r.id === role.id}
                data-role={r.id}
                data-dragging={drag === r.id}
                data-drop={drop?.id === r.id ? (drop.after ? "after" : "before") : undefined}
                draggable={canDrag}
                onDragStart={(e) => { if (!canDrag) return e.preventDefault(); setDrag(r.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (!drag || drag === r.id || !canDrag) return; e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); setDrop({ id: r.id, after: e.clientY > b.top + b.height / 2 }); }}
                onDrop={(e) => void onDrop(e)}
                onDragEnd={() => { setDrag(null); setDrop(null); }}
                onClick={() => { setSelected(r.id); if (r.id === serverId && tab === "members") setTab("display"); }}
              >
                <span className={s.dot} style={{ background: r.color ? hex(r.color) : "var(--text-muted)" }} />
                <span className={s.roleName}>{r.name}</span>
                <span className={s.roleCount}>{memberCount(r.id)}</span>
              </button>
            );
          })}
        </div>
        <div>
          <div className={s.tabs}>
            <button className={s.tab} data-on={view === "display"} onClick={() => setTab("display")}>{t("server.roles.display")}</button>
            <button className={s.tab} data-on={view === "permissions"} onClick={() => setTab("permissions")}>{t("server.channelSettings.permissions")}</button>
            {role.id !== serverId ? <button className={s.tab} data-on={tab === "members"} onClick={() => setTab("members")}>{t("server.roles.manageMembers")}</button> : null}
          </div>
          {view === "display" ? <DisplayTab key={role.id} role={role} editable={editable} everyone={role.id === serverId} onSaved={upsertRole} onDeleted={() => { removeRole(serverId, role.id); setSelected(serverId); }} /> : null}
          {view === "permissions" ? <PermissionsTab key={role.id} role={role} editable={editable} actorPerms={server.myPermissions} onSaved={upsertRole} /> : null}
          {view === "members" ? <MembersTab key={role.id} role={role} serverId={serverId} editable={editable} /> : null}
        </div>
      </div>
    </>
  );
}

function DisplayTab({ role, editable, everyone, onSaved, onDeleted }: { role: Role; editable: boolean; everyone: boolean; onSaved: (r: Role) => void; onDeleted: () => void }) {
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [hoist, setHoist] = useState(role.hoist);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [busy, setBusy] = useState(false);
  const dirty = name !== role.name || color !== role.color || hoist !== role.hoist || mentionable !== role.mentionable;
  const save = async () => {
    setBusy(true);
    try {
      const body: Parameters<typeof serversApi.patchRole>[2] = {};
      if (name !== role.name) body.name = name;
      if (color !== role.color) body.color = color;
      if (hoist !== role.hoist) body.hoist = hoist;
      if (mentionable !== role.mentionable) body.mentionable = mentionable;
      const saved = await serversApi.patchRole(role.server_id, role.id, body);
      onSaved(saved);
      // the server tidies whitespace in names, so show what it kept or the save bar never goes away
      setName(saved.name);
      setColor(saved.color);
      setHoist(saved.hoist);
      setMentionable(saved.mentionable);
      toast(t("server.roles.roleSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.roles.couldNotSaveTheRole"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={st.form}>
      {!everyone ? (
        <Field label={t("server.roles.roleName")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={!editable} data-testid="role-name" />
        </Field>
      ) : (
        <p className={st.hint}>{t("server.roles.everyoneIsTheBaseRoleEvery")}</p>
      )}
      <Field as="div" label={t("server.roles.roleColour")} hint={t("server.roles.membersUseTheColourOfTheir")}>
        <div className={s.swatches} role="radiogroup" aria-label={t("server.roles.roleColour")}>
          <span className={s.preview}><span className={s.dot} style={{ background: color ? hex(color) : "var(--text-muted)" }} />{name || "@everyone"}</span>
          <label className={s.swatch} data-on={color === 0} style={{ background: "var(--bg-active)" }} title={t("server.roles.default")}><input type="radio" checked={color === 0} disabled={!editable} onChange={() => setColor(0)} /></label>
          {SWATCHES.map((c) => (
            <label key={c} className={s.swatch} data-on={color === c} style={{ background: hex(c) }} title={hex(c)}><input type="radio" checked={color === c} disabled={!editable} onChange={() => setColor(c)} /></label>
          ))}
          <label className={s.swatch} style={{ background: color && !SWATCHES.includes(color) ? hex(color) : "var(--bg-surface)", border: "2px dashed var(--border-strong)" }} title={t("server.roles.customColour")}><input type="color" value={hex(color || 0x99aab5)} disabled={!editable} onChange={(e) => setColor(parseInt(e.target.value.slice(1), 16))} /></label>
        </div>
      </Field>
      {!everyone ? <Toggle checked={hoist} disabled={!editable} onChange={setHoist} label={t("server.roles.displayRoleMembersSeparatelyFromOnline")} /> : null}
      <Toggle checked={mentionable} disabled={!editable} onChange={setMentionable} label={t("server.roles.allowAnyoneToMentionThisRole")} description={t("server.roles.membersWithMentionEveryoneCanAlways")} />
      {!everyone && editable ? (
        <div>
          <Button variant="danger" size="sm" onClick={() => openModal("confirm", { title: `Delete '${role.name}'`, body: t("server.roles.membersLoseThisRoleAndAny"), confirmLabel: t("server.roles.deleteRole"), danger: true, onConfirm: async () => { await serversApi.deleteRole(role.server_id, role.id); onDeleted(); } })} data-testid="delete-role"><Trash2 size={14} /> {t("server.roles.deleteRole")}</Button>
        </div>
      ) : null}
      <SaveBar dirty={dirty} busy={busy} onReset={() => { setName(role.name); setColor(role.color); setHoist(role.hoist); setMentionable(role.mentionable); }} onSave={() => void save()} />
    </div>
  );
}

function PermissionsTab({ role, editable, actorPerms, onSaved }: { role: Role; editable: boolean; actorPerms: bigint; onSaved: (r: Role) => void }) {
  const toast = useUI((u) => u.toast);
  const [value, setValue] = useState(() => parsePerm(role.permissions));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const original = parsePerm(role.permissions);
  const dirty = value !== original;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await serversApi.patchRole(role.server_id, role.id, { permissions: permString(value) }));
      toast(t("server.channelSettings.permissionsSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.channelSettings.couldNotSavePermissions"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className={s.searchRow}>
        <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("server.roles.searchPermissions")} />
        <Button variant="ghost" size="sm" onClick={() => setValue(0n)} disabled={!editable}>{t("modals.quickSwitcher.clear")}</Button>
      </div>
      <p className={st.hint} style={{ marginBottom: 8 }}>{(actorPerms & (1n << 3n)) !== 0n ? t("server.roles.grantHintAll") : t("server.roles.grantHint")}</p>
      <RoleGrid value={value} onChange={setValue} editable={editable} filter={filter} />
      <SaveBar dirty={dirty} busy={busy} onReset={() => setValue(original)} onSave={() => void save()} />
    </div>
  );
}

function MembersTab({ role, serverId, editable }: { role: Role; serverId: string; editable: boolean }) {
  const server = useServers((x) => x.byId[serverId]);
  const upsertMember = useServers((x) => x.upsertMember);
  const users = useUsers((u) => u.byId);
  const toast = useUI((u) => u.toast);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!server) return null;
  const query = q.trim().toLowerCase();
  const members = Object.values(server.members)
    .map((m) => ({ m, name: memberName(m.nickname, users[m.user_id]), username: users[m.user_id]?.username ?? "", has: m.role_ids.includes(role.id) }))
    .filter((x) => !query || x.name.toLowerCase().includes(query) || x.username.includes(query))
    .sort((a, b) => Number(b.has) - Number(a.has) || a.name.localeCompare(b.name))
    .slice(0, 100);
  const toggle = async (userId: string, on: boolean) => {
    setBusy(userId);
    try {
      upsertMember(on ? await serversApi.addRole(serverId, userId, role.id) : await serversApi.removeRole(serverId, userId, role.id));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.memberAction.couldNotChangeRoles"), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <div className={s.searchRow}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("server.channelSettings.searchMembers")} />
      </div>
      {members.map(({ m, name, username, has }) => (
        <div key={m.user_id} className={s.memberRow}>
          <Avatar id={m.user_id} avatarId={m.avatar_id ?? users[m.user_id]?.avatar_id ?? null} name={name} size={32} />
          <div className={s.memberText}>
            <span className={s.memberName}>{name}</span>
            <span className={s.memberSub}>@{username}</span>
          </div>
          <Button size="sm" variant={has ? "secondary" : "primary"} disabled={!editable || busy === m.user_id} onClick={() => void toggle(m.user_id, !has)}>{has ? "Remove" : "Add"}</Button>
        </div>
      ))}
    </div>
  );
}
