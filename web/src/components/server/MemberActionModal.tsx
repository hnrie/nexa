import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { memberName } from "@/lib/names";
import { canManageRole } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { memberHighest, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "@/components/modals/ServerModals.module.css";
import r from "./RoleChips.module.css";

const DURATIONS: { v: number; label: string }[] = [
  { v: 60, label: "60 seconds" },
  { v: 300, label: "5 minutes" },
  { v: 600, label: "10 minutes" },
  { v: 3600, label: "1 hour" },
  { v: 86400, label: "1 day" },
  { v: 604800, label: "1 week" },
];

/** Kick, ban, timeout or edit the roles of one member. */
export default function MemberActionModal({ onClose, serverId, userId, action }: { onClose: () => void; serverId: string; userId: string; action: "kick" | "ban" | "timeout" | "roles" }) {
  const st = useServers((x) => x.byId[serverId]);
  const upsertMember = useServers((x) => x.upsertMember);
  const removeMember = useServers((x) => x.removeMember);
  const user = useUsers((u) => u.byId[userId]);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(0);
  const [duration, setDuration] = useState(600);
  const [busy, setBusy] = useState(false);
  const member = st?.members[userId];
  const name = memberName(member?.nickname, user);
  const timedOut = !!member?.timeout_until && member.timeout_until > Date.now();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!st) return null;
  const head = (
    <div className={s.serverRow}>
      <Avatar id={userId} avatarId={member?.avatar_id ?? user?.avatar_id ?? null} name={name} size={40} />
      <div>
        <div className={s.typeLabel}>{name}</div>
        <div className={s.typeDesc}>@{user?.username ?? userId}</div>
      </div>
    </div>
  );

  if (action === "roles") {
    const mine = meId ? memberHighest(st, meId) : { highest: 0, isOwner: false };
    const roles = rolesByPosition(st).filter((ro) => ro.id !== serverId);
    const toggle = (roleId: string, on: boolean) =>
      void run(async () => {
        upsertMember(on ? await serversApi.addRole(serverId, userId, roleId) : await serversApi.removeRole(serverId, userId, roleId));
      }).then(() => setBusy(false));
    return (
      <Modal open onClose={onClose} title="Edit Roles" width={440} footer={<Button onClick={onClose}>Done</Button>}>
        <div className={s.form}>
          {head}
          {roles.length === 0 ? <p className={s.hint}>This server has no roles yet. Create some in Server Settings.</p> : null}
          <div className={r.list}>
            {roles.map((ro) => {
              const on = member?.role_ids.includes(ro.id) ?? false;
              const allowed = canManageRole(mine.highest, mine.isOwner, ro.position);
              return (
                <label key={ro.id} className={r.row} data-disabled={!allowed}>
                  <input type="checkbox" checked={on} disabled={!allowed || busy} onChange={(e) => toggle(ro.id, e.target.checked)} />
                  <span className={r.dot} style={{ background: ro.color ? `#${ro.color.toString(16).padStart(6, "0")}` : "var(--text-muted)" }} />
                  <span className={r.name}>{ro.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>
    );
  }

  if (action === "timeout") {
    return (
      <Modal
        open
        onClose={onClose}
        title={timedOut ? `Remove timeout from ${name}` : `Time out ${name}`}
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  upsertMember(await serversApi.patchMember(serverId, userId, { timeout_until: timedOut ? null : Date.now() + duration * 1000 }));
                })
              }
            >
              {timedOut ? "Remove Timeout" : "Time Out"}
            </Button>
          </>
        }
      >
        <div className={s.form}>
          {head}
          {timedOut ? (
            <p className={s.hint}>They are timed out until {new Date(member!.timeout_until!).toLocaleString()}. Removing it lets them talk again right away.</p>
          ) : (
            <>
              <p className={s.hint}>Timed out members cannot send messages, react, or speak in voice channels. They can still read.</p>
              <Field label="Duration">
                <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </Select>
              </Field>
            </>
          )}
        </div>
      </Modal>
    );
  }

  const ban = action === "ban";
  return (
    <Modal
      open
      onClose={onClose}
      title={ban ? `Ban ${name}` : `Kick ${name}`}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() =>
              void run(async () => {
                if (ban) await serversApi.ban(serverId, userId, { reason, delete_message_days: days });
                else await serversApi.kick(serverId, userId, reason || undefined);
                removeMember(serverId, userId);
              })
            }
          >
            {ban ? "Ban" : "Kick"}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        {head}
        <p className={s.hint}>{ban ? `Are you sure you want to ban ${name}? They won't be able to rejoin unless they are unbanned.` : `Are you sure you want to kick ${name}? They will be able to rejoin with a new invite.`}</p>
        <p className={s.fine}>The server's encryption keys rotate after they are removed, so they cannot read anything sent afterwards.</p>
        <Field label="Reason (optional)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} autoFocus />
        </Field>
        {ban ? (
          <Field label="Delete message history">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={0}>Don't delete any</option>
              <option value={1}>Previous 24 hours</option>
              <option value={7}>Previous 7 days</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
