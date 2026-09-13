import { useState } from "react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { useUI } from "@/stores/ui";

interface Props {
  onClose: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}

export function ConfirmModal({ onClose, title, body, confirmLabel = "Confirm", danger = false, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      // most callers let the request's error through; say what went wrong and keep the dialog open to retry
      useUI.getState().toast(err instanceof ApiError ? err.message : "Something went wrong.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} width={440} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={() => void go()}>{confirmLabel}</Button></>}>
      <div style={{ color: "var(--text)", fontSize: 16 }}>{body}</div>
    </Modal>
  );
}
