import { Link, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dmOpenError } from "@/lib/errors";
import { addFriendToGroup, isLinkOnly } from "@/lib/groupAdd";
import { channels as channelsApi } from "@/api/channels";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { TextInput } from "@/components/common/TextInput";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { LinkOnlyTag } from "./LinkOnlyTag";
import g from "./GroupAdd.module.css";
import s from "./CreateDMModal.module.css";

import { t } from "@/i18n";
// only the create call is batched; a group grows without limit after that
const MAX = 49;

export function CreateDMModal({ onClose, initial = [], groupId }: { onClose: () => void; initial?: string[]; groupId?: string | undefined }) {
  const nav = useNavigate();
  const rels = useRelationships((r) => r.byUser);
  const users = useUsers((u) => u.byId);
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
  // A friend who joins groups only from a link can still be picked alone, for
  // a direct message, but not for a group: adding to one, or with someone else
  // picked. One picked first, before anyone else, holds the group back until
  // they are taken off again.
  const linkOnly = (id: string) => isLinkOnly(users[id] ?? rels[id]?.user);
  const forGroup = (id: string) => !!group || picked.some((x) => x !== id);
  const heldBy = group || picked.length > 1 ? picked.find(linkOnly) : undefined;
  const heldName = heldBy ? (rels[heldBy]?.user.display_name ?? users[heldBy]?.display_name ?? heldBy) : "";

  // Nobody picked makes a group of one, to add people to later; adding to a
  // group that exists needs someone to add.
  const canCreate = (!group || picked.length > 0) && !heldBy;
  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      if (group) {
        for (const id of picked) {
          // Someone added on an earlier try that then failed is already in, and adding them again
          // is refused before the rest are reached, so skip them and drop each success from the picks.
          if (useChannels.getState().byId[group.id]?.recipient_ids.includes(id)) continue;
          await addFriendToGroup(group.id, id);
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
      toast(dmOpenError(err, t("modals.createDM.couldNotCreateTheConversation")), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("modals.createDM.selectFriends")} width={440} footer={<Button block onClick={() => void create()} loading={busy} disabled={!canCreate} data-testid="create-dm-submit">{group ? t("modals.createDM.addToGroup") : picked.length === 1 ? t("modals.createDM.createDm") : t("modals.createDM.createGroupDm")}</Button>}>
      <p className={s.hint}>{group ? t("modals.createDM.addAnyoneYouAreFriendsWith") : picked.length >= MAX ? t("modals.createDM.addTheRestWithAnInvite") : t("modals.createDM.pickFriendsToStartAGroup")}</p>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("modals.createDM.typeTheUsernameOfAFriend")} aria-label={t("modals.createDM.typeTheUsernameOfAFriend")} autoFocus />
      {/* Picked friends as chips: a search that filtered someone's row out
          used to take the only sign they were chosen with it. */}
      {picked.length > 0 ? (
        <div className={s.chips} role="group" aria-label={t("modals.createDM.chosen")}>
          {picked.map((id) => {
            const u = rels[id]?.user;
            const shownName = u?.display_name ?? id;
            return (
              <button key={id} type="button" className={s.chip} onClick={() => toggle(id)} aria-label={t("modals.createDM.removeName", { name: shownName })} title={t("modals.createDM.removeName", { name: shownName })}>
                <Avatar id={id} avatarId={u?.avatar_id ?? null} name={shownName} size={16} />
                <span className={s.chipName}>{shownName}</span>
                <X size={12} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
      {heldBy ? (
        <p className={g.warn} role="alert" data-testid="link-only-held">
          <Link size={16} aria-hidden="true" />
          <span>{t("modals.createDM.linkOnlyInGroup", { name: heldName })}</span>
        </p>
      ) : null}
      {!group && picked.length > 1 ? <TextInput className={s.name} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("modals.createDM.groupNameOptional")} aria-label={t("modals.createDM.groupNameOptional")} maxLength={100} /> : null}
      <div className={s.list}>
        {shown.length === 0 ? <div className={s.empty}>{friends.length === 0 ? t("modals.createDM.addSomeFriendsFirst") : t("modals.createDM.noFriendsMatch")}</div> : null}
        {shown.map((r) => {
          const who = (
            <>
              <Avatar id={r.user.id} avatarId={r.user.avatar_id} name={r.user.display_name} size={32} />
              <span className={s.text}>
                <span className={s.rowName}>{r.user.display_name}</span>
                <span className={s.rowUser}>{r.user.username}</span>
              </span>
            </>
          );
          // not a label: there is nothing to tick, and a click on the row would
          // otherwise land on the Link Only button inside it
          if (linkOnly(r.user.id) && forGroup(r.user.id) && !picked.includes(r.user.id)) {
            return (
              <div key={r.user.id} className={s.row} data-link-only="true">
                {who}
                <LinkOnlyTag name={r.user.display_name} />
              </div>
            );
          }
          return (
            <label key={r.user.id} className={s.row}>
              {who}
              <input type="checkbox" checked={picked.includes(r.user.id)} onChange={() => toggle(r.user.id)} />
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
