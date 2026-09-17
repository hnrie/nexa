import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
/** Edit your nickname in one server (or someone else's, with Manage Nicknames). */
export function ServerProfileModal({ onClose, serverId, userId }: { onClose: () => void; serverId: string; userId?: string | undefined }) {
  const me = useAuth((a) => a.me);
  const st = useServers((x) => x.byId[serverId]);
  const upsertMember = useServers((x) => x.upsertMember);
  const toast = useUI((u) => u.toast);
  const target = userId ?? me?.id ?? "";
  const [nick, setNick] = useState(st?.members[target]?.nickname ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    try {
      upsertMember(await serversApi.patchMember(serverId, target === me?.id ? "@me" : target, { nick: value.trim() || null }));
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("modals.serverProfile.couldNotChangeTheNickname"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={target === me?.id ? t("modals.serverProfile.changeNickname") : t("modals.serverProfile.changeTheirNickname")} width={440} footer={<><Button variant="ghost" onClick={() => void save("")} disabled={busy}>{t("modals.serverProfile.resetNickname")}</Button><Button onClick={() => void save(nick)} loading={busy}>{t("chat.editMessage.save")}</Button></>}>
      <div className={s.form}>
        <Field label={t("modals.serverProfile.nickname")} hint={t("modals.serverProfile.howYouAppearIn", { name: st?.server.name ?? t("modals.serverProfile.thisServer") })}>
          <TextInput value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={me?.display_name} autoFocus onKeyDown={(e) => e.key === "Enter" && void save(nick)} />
        </Field>
      </div>
    </Modal>
  );
}
