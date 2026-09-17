/**
 * Making a subchat and editing one: its name, and the password that keeps it
 * shut. The password is stretched on this device (lib/subchatLock); what
 * reaches the server proves it was typed and nothing more.
 */
import { useState } from "react";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { newLock, passwordProblem } from "@/lib/subchatLock";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";

import { t } from "@/i18n";
const MAX_NAME = 48;

export default function SubchatModal({ onClose, channel, parentId }: { onClose: () => void; channel?: Channel; parentId?: string }) {
  const editing = !!channel;
  const toast = useUI((u) => u.toast);
  const upsert = useChannels((c) => c.upsert);
  const [name, setName] = useState(channel?.name ?? "");
  // editing: a subchat that already has one keeps it unless this is switched
  const [wantsPassword, setWantsPassword] = useState(!!channel?.locked);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changingPassword = wantsPassword && (!channel?.locked || password.length > 0);
  const removingPassword = editing && !!channel?.locked && !wantsPassword;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError(t("modals.subchat.giveTheSubchatAName"));
    if (changingPassword) {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
      if (password !== confirm) return setError("Those two passwords are different.");
    }
    setBusy(true);
    setError(null);
    try {
      const lock: Record<string, unknown> | undefined = changingPassword ? { ...(await newLock(password)) } : removingPassword ? { password_remove: true } : undefined;
      if (editing && channel) {
        const next = await channelsApi.patch(channel.id, { name: trimmed, ...(lock ?? {}) });
        upsert(next);
      } else if (parentId) {
        const made = await channelsApi.createSubchat(parentId, trimmed, lock);
        upsert(made);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("modals.subchat.thatCouldNotBeSaved"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? t("chat.subchat.editSubchat") : t("modals.subchat.newSubchat")} open onClose={onClose} width={440}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label={t("modals.subchat.name")} required>
          <TextInput value={name} maxLength={MAX_NAME} autoFocus onChange={(e) => setName(e.target.value)} data-testid="subchat-modal-name" />
        </Field>
        <Toggle
          checked={wantsPassword}
          onChange={(v) => {
            setWantsPassword(v);
            setPassword("");
            setConfirm("");
          }}
          label={t("modals.subchat.askForAPassword")}
          description={t("modals.subchat.everyoneInTheSubchatTypesIt")}
        />
        {wantsPassword ? (
          <>
            <Field label={channel?.locked ? t("settings.account.newPassword") : "Password"}>
              <TextInput
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder={channel?.locked ? t("modals.subchat.leaveEmptyToKeepTheCurrent") : undefined}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="subchat-modal-password"
              />
            </Field>
            {password ? (
              <Field label={t("modals.subchat.typeItAgain")}>
                <TextInput type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            ) : null}
          </>
        ) : null}
        {error ? <div style={{ color: "var(--danger)", fontSize: 14 }}>{error}</div> : null}
        <Button block loading={busy} disabled={!name.trim()} onClick={() => void save()} data-testid="subchat-modal-save">
          {editing ? "Save" : t("modals.subchat.createSubchat")}
        </Button>
      </div>
    </Modal>
  );
}
