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
        for (const id of picked) upsert(await channelsApi.addRecipient(group.id, id));
        onClose();
        return;
      }
      const ch = await channelsApi.createDM(picked, picked.length > 1 ? name.trim() : undefined);
      upsert(ch);
      onClose();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the conversation.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Select Friends" width={440} footer={<Button block onClick={() => void create()} loading={busy} disabled={picked.length === 0}>{group ? "Add to Group" : picked.length > 1 ? "Create Group DM" : "Create DM"}</Button>}>
      <p className={s.hint}>{group ? "Add anyone you are friends with; groups have no size limit." : picked.length >= MAX ? "Add the rest with an invite link once the group exists." : `Pick friends to start a group, or one person for a DM.`}</p>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the username of a friend" autoFocus />
      {picked.length > 1 ? <TextInput className={s.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (optional)" maxLength={100} /> : null}
      <div className={s.list}>
        {shown.length === 0 ? <div className={s.empty}>{friends.length === 0 ? "Add some friends first." : "No friends match."}</div> : null}
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
