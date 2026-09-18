/**
 * The question that has to be answered before a conversation key is sealed to a
 * changed identity key.
 *
 * There is no path in the API that changes a user's `public_key` — registration
 * writes it and nothing else touches it, and registering again produces a new
 * account with a new id — so a key that changes under a name that has not is
 * either the database having been restored from somewhere, or somebody standing
 * between this device and the person it thinks it is talking to.
 *
 * Until this is answered the client seals nothing to the new key. That is a
 * deliberate, visible pause rather than a silent one: the person is told what
 * accepting means, and told that the safe way to decide is to ask over some
 * other channel.
 */
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { SafetyNumber } from "@/components/profile/KeyVerify";
import { useKeyAlerts } from "@/stores/keyAlerts";
import { useKeys } from "@/stores/keys";
import { displayName, useUsers } from "@/stores/users";
import s from "@/components/profile/KeyVerify.module.css";

import { t } from "@/i18n";

export default function KeyChangeModal({ onClose }: { onClose: () => void }) {
  const pending = useKeyAlerts((k) => k.pending);
  const accept = useKeyAlerts((k) => k.acceptKeyChange);
  const reject = useKeyAlerts((k) => k.rejectKeyChange);
  const users = useUsers((u) => u.byId);
  const [busy, setBusy] = useState(false);
  const list = Object.values(pending);
  const change = list[0];
  if (!change) {
    // The last one was answered; nothing left to ask about.
    return null;
  }
  const name = displayName(users[change.userId]);
  const onAccept = () => {
    setBusy(true);
    accept(change.userId);
    // Whatever was withheld while the question stood is handed over now; the
    // server is asked afresh what is still owed rather than replaying anything.
    void useKeys
      .getState()
      .reconcile()
      .catch(() => undefined)
      .finally(() => setBusy(false));
    if (Object.keys(useKeyAlerts.getState().pending).length === 0) onClose();
  };
  const onReject = () => {
    reject(change.userId);
    if (Object.keys(useKeyAlerts.getState().pending).length === 0) onClose();
  };
  return (
    <Modal
      open
      onClose={onReject}
      closeOnOverlay={false}
      title={t("encryption.keyChangedTitle", { name })}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onReject}>{t("encryption.keyChangedNotNow")}</Button>
          <Button variant="danger" loading={busy} onClick={onAccept} data-testid="accept-key-change">{t("encryption.keyChangedAccept")}</Button>
        </>
      }
    >
      <div className={s.panel} data-testid="key-change-modal">
        <p className={s.warn}>{t("encryption.keyChangedWarning", { name })}</p>
        <div className={s.pair}>
          <p className={s.pairLabel}>{t("encryption.keyChangedNewLabel")}</p>
          <SafetyNumber publicKey={change.offered} />
        </div>
        <div className={s.pair}>
          <p className={s.pairLabel}>{t("encryption.keyChangedOldLabel")}</p>
          <SafetyNumber publicKey={change.pinned} qr={false} old />
        </div>
        <p className={s.note}>{t("encryption.keyChangedMeaning", { name })}</p>
        {list.length > 1 ? <p className={s.note}>{t("encryption.keyChangedMore", { count: list.length - 1 })}</p> : null}
      </div>
    </Modal>
  );
}
