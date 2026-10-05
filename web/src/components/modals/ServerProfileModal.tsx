import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { P } from "@/lib/perms";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";

/**
 * Someone else's profile in a server, for a moderator with Manage
 * Nicknames: their nickname to change, and what they set for the server
 * (picture, banner, theme, About Me, widgets) to take away if it breaks the
 * rules. One's own server profile is edited in Settings, Profiles.
 */
export function ServerProfileModal({ onClose, serverId, userId }: { onClose: () => void; serverId: string; userId?: string | undefined }) {
  const st = useServers((x) => x.byId[serverId]);
  const upsertMember = useServers((x) => x.upsertMember);
  const toast = useUI((u) => u.toast);
  const target = userId ?? "";
  const member = st?.members[target];
  const user = useUsers((u) => u.byId[target]);
  const [nick, setNick] = useState(member?.nickname ?? "");
  const [busy, setBusy] = useState(false);
  const mod = canI(st, P.MANAGE_NICKNAMES);

  const save = async () => {
    setBusy(true);
    try {
      if (nick.trim() !== (member?.nickname ?? "")) upsertMember(await serversApi.patchMember(serverId, target, { nick: nick.trim() || null }));
      toast(t("serverProfile.nickSaved"), "success");
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("modals.serverProfile.couldNotChangeTheNickname"), "error");
    } finally {
      setBusy(false);
    }
  };
  const resetOthers = async () => {
    setBusy(true);
    try {
      let m = await serversApi.patchMember(serverId, target, { bio: "", pronouns: "", accent_color: null, accent_color_2: null, widgets: null });
      if (m.avatar_id) m = await serversApi.deleteMemberImage(serverId, target, "avatar");
      if (m.banner_id) m = await serversApi.deleteMemberImage(serverId, target, "banner");
      upsertMember(m);
      toast(t("serverProfile.resetDone"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("serverProfile.uploadFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const serverName = st?.server.name ?? t("modals.serverProfile.thisServer");
  return (
    <Modal
      open
      onClose={onClose}
      title={t("modals.serverProfile.changeTheirNickname")}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void save()} loading={busy} data-testid="server-profile-save">{t("chat.editMessage.save")}</Button>
        </>
      }
    >
      <div className={s.form}>
        <Field label={t("modals.serverProfile.nickname")} hint={t("serverProfile.theirNickHint", { name: serverName })}>
          <TextInput value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={user ? displayName(user) : undefined} autoFocus />
        </Field>
        {mod ? (
          <div>
            <p className={s.hint}>{t("serverProfile.othersResetHint")}</p>
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void resetOthers()} data-testid="server-profile-reset">{t("serverProfile.resetOthers")}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
