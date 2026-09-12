import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import s from "./ServerModals.module.css";

export function CreateCategoryModal({ onClose, serverId }: { onClose: () => void; serverId: string }) {
  const upsert = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      upsert(await serversApi.createChannel(serverId, { type: "category", name: name.trim() }));
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the category.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Create Category" width={440} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void create()} loading={busy} disabled={!name.trim()}>Create Category</Button></>}>
      <div className={s.form}>
        <Field label="Category name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="New Category" maxLength={100} autoFocus onKeyDown={(e) => e.key === "Enter" && void create()} />
        </Field>
      </div>
    </Modal>
  );
}
