import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { memberName } from "@/lib/names";
import { formatFull } from "@/lib/time";
import { canManageRole } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { memberHighest, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "@/components/modals/ServerModals.module.css";
import r from "./RoleChips.module.css";

import { t } from "@/i18n";
function durations(): { v: number; label: string }[] {
  return [
  { v: 60, label: t("server.memberAction.60Seconds") },
  { v: 300, label: t("server.memberAction.5Minutes") },
  { v: 600, label: t("server.memberAction.10Minutes") },
  { v: 3600, label: t("modals.customStatus.1Hour") },
  { v: 86400, label: t("modals.groupInvite.1Day") },
  { v: 604800, label: t("server.memberAction.1Week") },
];
}

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
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const member = st?.members[userId];
  const name = memberName(member?.nickname, user);
  const timedOut = !!member?.timeout_until && member.timeout_until > Date.now();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.memberAction.thatDidnTWork"), "error");
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
        <div className={s.typeDesc}><bdi>@{user?.username ?? userId}</bdi></div>
      </div>
    </div>
  );

  if (action === "roles") {
    const mine = meId ? memberHighest(st, meId) : { highest: 0, isOwner: false };
    const roles = rolesByPosition(st).filter((ro) => ro.id !== serverId);
    const toggle = async (roleId: string, on: boolean) => {
      setOptimistic((o) => ({ ...o, [roleId]: on }));
      try {
        upsertMember(on ? await serversApi.addRole(serverId, userId, roleId) : await serversApi.removeRole(serverId, userId, roleId));
      } catch (err) {
        toast(err instanceof ApiError ? err.message : t("server.memberAction.couldNotChangeRoles"), "error");
      } finally {
        setOptimistic((o) => {
          const next = { ...o };
          delete next[roleId];
          return next;
        });
      }
    };
    return (
      <Modal open onClose={onClose} title={t("server.memberAction.editRoles")} width={440} footer={<Button onClick={onClose}>{t("modals.serverNotifications.done")}</Button>}>
        <div className={s.form}>
          {head}
          {roles.length === 0 ? <p className={s.hint}>{t("server.memberAction.thisServerHasNoRolesYet")}</p> : null}
          <div className={r.list}>
            {roles.map((ro) => {
              const on = optimistic[ro.id] ?? member?.role_ids.includes(ro.id) ?? false;
              const allowed = canManageRole(mine.highest, mine.isOwner, ro.position);
              return (
                <label key={ro.id} className={r.row} data-disabled={!allowed}>
                  <input type="checkbox" checked={on} disabled={!allowed} onChange={(e) => void toggle(ro.id, e.target.checked)} />
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
        title={timedOut ? t("server.memberAction.removeTimeoutFrom", { name }) : t("server.memberAction.timeOutNamed", { name })}
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  upsertMember(await serversApi.patchMember(serverId, userId, { timeout_until: timedOut ? null : Date.now() + duration * 1000 }));
                })
              }
            >
              {timedOut ? t("server.memberAction.removeTimeout") : t("server.memberAction.timeOut")}
            </Button>
          </>
        }
      >
        <div className={s.form}>
          {head}
          {timedOut ? (
            <p className={s.hint}>{t("server.memberAction.timedOutUntil", { when: formatFull(member!.timeout_until!) })}</p>
          ) : (
            <>
              <p className={s.hint}>{t("server.memberAction.timedOutMembersCannotSendMessages")}</p>
              <Field label={t("server.memberAction.duration")}>
                <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {durations().map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
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
      title={ban ? t("server.memberAction.banNamed", { name }) : t("server.memberAction.kickNamed", { name })}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
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
            {ban ? t("server.members.ban") : t("server.members.kick")}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        {head}
        <p className={s.hint}>{ban ? t("server.memberAction.confirmBan", { name }) : t("server.memberAction.confirmKick", { name })}</p>
        <p className={s.fine}>{t("server.memberAction.theServerSEncryptionKeysRotate")}</p>
        <Field label={t("server.memberAction.reasonOptional")}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} autoFocus />
        </Field>
        {ban ? (
          <Field label={t("server.memberAction.deleteMessageHistory")}>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={0}>{t("server.memberAction.donTDeleteAny")}</option>
              <option value={1}>{t("server.memberAction.previous24Hours")}</option>
              <option value={7}>{t("server.memberAction.previous7Days")}</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
