import { Modal } from "@/components/common/Modal";
import { t } from "@/i18n";
import { NoteLinkView, linkSecret } from "./NoteLinkView";

/** A note's share link, opened inside the app: what it leads to, and joining it. */
export function NoteLinkDialog({ token, hash, onClose }: { token: string; hash: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} bare ariaLabel={t("notes.link.dialogLabel")} width={460}>
      <NoteLinkView secret={linkSecret(token, hash)} variant="dialog" onDone={onClose} />
    </Modal>
  );
}
