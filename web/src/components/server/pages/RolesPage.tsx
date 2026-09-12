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
import s from "../ServerSettings.module.css";

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
  const memberCount = (id: string) => (id === serverId ? server.memberCount : Object.values(server.members).filter((m) => m.role_ids.includes(id)).length);

  const create = async () => {
    setBusy(true);
    try {
      const r = await serversApi.createRole(serverId, { name: "new role" });
      upsertRoles(serverId, await serversApi.roles(serverId));
      setSelected(r.id);
      setTab("display");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the role.", "error");
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
    if (!d || !at || d === at.id) return;
    const list = roles.filter((r) => r.id !== serverId && r.id !== d);
    const moving = server.roles[d];
    if (!moving) return;
    const idx = list.findIndex((r) => r.id === at.id) + (at.after ? 1 : 0);
    list.splice(idx, 0, moving);
    // top of the list = highest position
    const positions = list.map((r, i) => ({ id: r.id, position: list.length - i }));
    try {
      upsertRoles(serverId, await serversApi.setRolePositions(serverId, positions));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reorder roles.", "error");
    }
  };

  return (
    <>
      <h2 className={st.title}>Roles</h2>
      <p className={st.hint}>Use roles to group your members and assign permissions. Drag roles to reorder them: members can only manage roles below their own highest role.</p>
      <div className={s.rolesLayout}>
        <div className={s.roleList}>
          <Button size="sm" variant="secondary" onClick={() => void create()} loading={busy} style={{ marginBottom: 8 }} data-testid="create-role"><Plus size={14} /> Create Role</Button>
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
                onDragOver={(e) => { if (!drag || drag === r.id || r.id === serverId) return; e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); setDrop({ id: r.id, after: e.clientY > b.top + b.height / 2 }); }}
                onDrop={(e) => void onDrop(e)}
                onDragEnd={() => { setDrag(null); setDrop(null); }}
                onClick={() => setSelected(r.id)}
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
            <button className={s.tab} data-on={tab === "display"} onClick={() => setTab("display")}>Display</button>
            <button className={s.tab} data-on={tab === "permissions"} onClick={() => setTab("permissions")}>Permissions</button>
            {role.id !== serverId ? <button className={s.tab} data-on={tab === "members"} onClick={() => setTab("members")}>Manage Members</button> : null}
          </div>
          {tab === "display" ? <DisplayTab key={role.id} role={role} editable={editable} everyone={role.id === serverId} onSaved={upsertRole} onDeleted={() => { removeRole(serverId, role.id); setSelected(serverId); }} /> : null}
          {tab === "permissions" ? <PermissionsTab key={role.id} role={role} editable={editable} actorPerms={server.myPermissions} onSaved={upsertRole} /> : null}
          {tab === "members" ? <MembersTab key={role.id} role={role} serverId={serverId} editable={editable} /> : null}
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
      onSaved(await serversApi.patchRole(role.server_id, role.id, body));
      toast("Role saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the role.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={st.form}>
      {!everyone ? (
        <Field label="Role name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={!editable} data-testid="role-name" />
        </Field>
      ) : (
        <p className={st.hint}>@everyone is the base role every member has. You can change its colour and permissions but not its name.</p>
      )}
      <Field label="Role colour" hint="Members use the colour of their highest role that has one.">
        <div className={s.swatches}>
          <span className={s.preview}><span className={s.dot} style={{ background: color ? hex(color) : "var(--text-muted)" }} />{name || "@everyone"}</span>
          <label className={s.swatch} data-on={color === 0} style={{ background: "var(--bg-active)" }} title="Default"><input type="radio" checked={color === 0} disabled={!editable} onChange={() => setColor(0)} /></label>
          {SWATCHES.map((c) => (
            <label key={c} className={s.swatch} data-on={color === c} style={{ background: hex(c) }} title={hex(c)}><input type="radio" checked={color === c} disabled={!editable} onChange={() => setColor(c)} /></label>
          ))}
          <label className={s.swatch} style={{ background: color && !SWATCHES.includes(color) ? hex(color) : "var(--bg-surface)", border: "2px dashed var(--border-strong)" }} title="Custom colour"><input type="color" value={hex(color || 0x99aab5)} disabled={!editable} onChange={(e) => setColor(parseInt(e.target.value.slice(1), 16))} /></label>
        </div>
      </Field>
      {!everyone ? <Toggle checked={hoist} disabled={!editable} onChange={setHoist} label="Display role members separately from online members" /> : null}
      <Toggle checked={mentionable} disabled={!editable} onChange={setMentionable} label="Allow anyone to @mention this role" description="Members with Mention @everyone can always mention roles." />
      {!everyone && editable ? (
        <div>
          <Button variant="danger" size="sm" onClick={() => openModal("confirm", { title: `Delete '${role.name}'`, body: "Members lose this role and any permissions it granted. This cannot be undone.", confirmLabel: "Delete Role", danger: true, onConfirm: async () => { await serversApi.deleteRole(role.server_id, role.id); onDeleted(); } })} data-testid="delete-role"><Trash2 size={14} /> Delete Role</Button>
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
      toast("Permissions saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save permissions.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className={s.searchRow}>
        <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search permissions" />
        <Button variant="ghost" size="sm" onClick={() => setValue(0n)} disabled={!editable}>Clear</Button>
      </div>
      <p className={st.hint} style={{ marginBottom: 8 }}>You can only grant permissions you hold yourself{(actorPerms & (1n << 3n)) !== 0n ? " (you have all of them)" : ""}.</p>
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
      toast(err instanceof ApiError ? err.message : "Could not change roles.", "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <div className={s.searchRow}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" />
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
