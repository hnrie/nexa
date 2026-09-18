import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { describeError } from "@/lib/errors";
import { useUI } from "@/stores/ui";

import { t } from "@/i18n";
interface Props {
  onClose: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}

export function ConfirmModal({ onClose, title, body, confirmLabel, danger = false, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      // most callers let the request's error through; say what went wrong and keep the dialog open to retry
      useUI.getState().toast(describeError(err, t("modals.confirm.somethingWentWrong")), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} width={440} footer={<><Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={() => void go()}>{confirmLabel ?? t("modals.confirm.confirm")}</Button></>}>
      <div style={{ color: "var(--text)", fontSize: 16 }}>{body}</div>
    </Modal>
  );
}
