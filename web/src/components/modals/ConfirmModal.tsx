import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { describeError } from "@/lib/errors";
import { useUI } from "@/stores/ui";

import { t } from "@/i18n";
interface Props {
  onClose: () => void;
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel?: string;
  /** The cancel button's words, where something other than Cancel fits better. */
  cancelLabel?: string;
  danger?: boolean;
  checkboxLabel?: string;
  onConfirm: (checked: boolean) => Promise<unknown> | unknown;
}

export function ConfirmModal({ onClose, title, body, confirmLabel, cancelLabel, danger = false, checkboxLabel, onConfirm }: Props) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm(checked);
      onClose();
    } catch (err) {
      // most callers let the request's error through; say what went wrong and keep the dialog open to retry
      useUI.getState().toast(describeError(err, t("modals.confirm.somethingWentWrong")), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} width={440} footer={<><Button variant="ghost" onClick={onClose}>{cancelLabel ?? t("chat.editMessage.cancel")}</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={() => void go()}>{confirmLabel ?? t("modals.confirm.confirm")}</Button></>}>
      <div style={{ color: "var(--text)", fontSize: 16 }}>{body}</div>
      {checkboxLabel && (
        <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, marginTop: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setChecked(e.target.checked)} />
          {checkboxLabel}
        </label>
      )}
    </Modal>
  );
}
