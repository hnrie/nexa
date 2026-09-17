import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { TextInput } from "@/components/common/TextInput";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import s from "./CreateDMModal.module.css";

import { t } from "@/i18n";
// only the create call is batched; a group grows without limit after that
const MAX = 49;

export function CreateDMModal({ onClose, initial = [], groupId }: { onClose: () => void; initial?: string[]; groupId?: string | undefined }) {
  const nav = useNavigate();
  const rels = useRelationships((r) => r.byUser);
  const upsert = useChannels((c) => c.upsert);
  const group = useChannels((c) => (groupId ? c.byId[groupId] : undefined));
  const toast = useUI((u) => u.toast);
  const [picked, setPicked] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const friends = useMemo(
    () => Object.values(rels).filter((r) => r.type === "friend" && !(group?.recipient_ids ?? []).includes(r.user.id)).sort((a, b) => a.user.display_name.localeCompare(b.user.display_name)),
    [rels, group],
  );
  const shown = friends.filter((r) => !q || r.user.display_name.toLowerCase().includes(q.toLowerCase()) || r.user.username.includes(q.toLowerCase()));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]));

  const create = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      if (group) {
        for (const id of picked) {
          // Someone added on an earlier try that then failed is already in, and adding them again
          // is refused before the rest are reached, so skip them and drop each success from the picks.
          if (useChannels.getState().byId[group.id]?.recipient_ids.includes(id)) continue;
          upsert(await channelsApi.addRecipient(group.id, id));
          setPicked((p) => p.filter((x) => x !== id));
        }
        onClose();
        return;
      }
      const ch = await channelsApi.createDM(picked, picked.length > 1 ? name.trim() : undefined);
      upsert(ch);
      onClose();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("modals.createDM.couldNotCreateTheConversation"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("modals.createDM.selectFriends")} width={440} footer={<Button block onClick={() => void create()} loading={busy} disabled={picked.length === 0}>{group ? t("modals.createDM.addToGroup") : picked.length > 1 ? t("modals.createDM.createGroupDm") : t("modals.createDM.createDm")}</Button>}>
      <p className={s.hint}>{group ? t("modals.createDM.addAnyoneYouAreFriendsWith") : picked.length >= MAX ? t("modals.createDM.addTheRestWithAnInvite") : t("modals.createDM.pickFriendsToStartAGroup")}</p>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("modals.createDM.typeTheUsernameOfAFriend")} autoFocus />
      {picked.length > 1 ? <TextInput className={s.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("modals.createDM.groupNameOptional")} maxLength={100} /> : null}
      <div className={s.list}>
        {shown.length === 0 ? <div className={s.empty}>{friends.length === 0 ? t("modals.createDM.addSomeFriendsFirst") : t("modals.createDM.noFriendsMatch")}</div> : null}
        {shown.map((r) => (
          <label key={r.user.id} className={s.row}>
            <Avatar id={r.user.id} avatarId={r.user.avatar_id} name={r.user.display_name} size={32} />
            <span className={s.text}>
              <span className={s.rowName}>{r.user.display_name}</span>
              <span className={s.rowUser}>{r.user.username}</span>
            </span>
            <input type="checkbox" checked={picked.includes(r.user.id)} onChange={() => toggle(r.user.id)} />
          </label>
        ))}
      </div>
    </Modal>
  );
}
