/**
 * The safety-number dialog: someone's identity key, in a form two people can
 * compare without the server in the middle.
 */
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { KeyVerifyBody } from "@/components/profile/KeyVerify";
import { useAuth } from "@/stores/auth";
import { displayName, useUsers } from "@/stores/users";

import { t } from "@/i18n";

export default function VerifyKeyModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const me = useAuth((a) => a.me);
  const user = useUsers((u) => u.byId[userId]);
  const name = userId === me?.id ? t("encryption.yourOwnKey") : displayName(user);
  return (
    <Modal open onClose={onClose} title={t("encryption.safetyNumberTitle")} width={420} footer={<Button onClick={onClose}>{t("modals.serverNotifications.done")}</Button>}>
      <KeyVerifyBody userId={userId} name={name} />
    </Modal>
  );
}
