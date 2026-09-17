import { useState } from "react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { IconPicker } from "@/components/common/IconPicker";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { managesGroup } from "@/components/sidebar/dmMenu";
import { initials } from "@/lib/avatarColor";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
/** A group's name and icon. Anyone in it can rename it; its owner sets the icon. */
export function EditGroupModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const ch = useChannels((c) => c.byId[channelId]);
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [name, setName] = useState(ch?.name ?? "");
  const [icon, setIcon] = useState<File | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ch || ch.type !== "group_dm") return null;
  const owner = managesGroup(ch);
  const current = removeIcon ? null : iconUrl(ch.icon_id, 80);
  const shownName = name.trim() || channelDisplayName(ch, users, meId);
  const dirty = name.trim() !== (ch.name ?? "") || !!icon || removeIcon;

  const save = async () => {
    setBusy(true);
    try {
      let next = ch;
      if (name.trim() !== (ch.name ?? "")) next = await channelsApi.patch(ch.id, { name: name.trim() });
      if (icon) next = await channelsApi.uploadIcon(ch.id, icon);
      else if (removeIcon && ch.icon_id) {
        await channelsApi.deleteIcon(ch.id);
        next = { ...next, icon_id: null };
      }
      useChannels.getState().upsert(next);
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("modals.editGroup.couldNotSaveTheGroup"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("modals.editGroup.editGroup")}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="save-group">{t("chat.editMessage.save")}</Button>
        </>
      }
    >
      <div className={s.form}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <IconPicker
            currentUrl={current}
            picked={icon}
            onPick={(f) => {
              setIcon(f);
              setRemoveIcon(false);
            }}
            onRemove={() => {
              setIcon(null);
              setRemoveIcon(true);
            }}
            initials={initials(shownName)}
            label={t("modals.editGroup.groupIcon")}
            disabled={!owner}
            testId="group-icon"
          />
          <p className={s.hint}>{owner ? t("modals.editGroup.pickAPictureForTheGroup") : t("modals.editGroup.onlyTheGroupSOwnerCan")}</p>
        </div>
        <Field label={t("modals.editGroup.groupName")}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={channelDisplayName({ ...ch, name: "" }, users, meId)} data-testid="group-name" onKeyDown={(e) => e.key === "Enter" && dirty && void save()} />
        </Field>
      </div>
    </Modal>
  );
}
