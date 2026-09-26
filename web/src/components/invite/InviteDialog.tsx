import { KeyRound, Lock, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { t } from "@/i18n";
import { loadInvitePreview, useInvitePreview } from "@/lib/invitePreviews";
import { InviteGone, InviteSkeleton, InviteView, targetOfPreview } from "./InviteView";
import { useInviteJoin } from "./useInviteJoin";
import s from "./Invite.module.css";

/**
 * An invite link opened inside the app: the server or group it leads to,
 * with Join (or Open, when already in) right there, instead of the public
 * invite page in a new tab. `hash` is the link's fragment, whose key unlocks
 * the history once joined.
 */
export function InviteDialog({ onClose, code, hash }: { onClose: () => void; code: string; hash: string }) {
  const entry = useInvitePreview(code);
  const preview = entry?.status === "ready" ? entry.preview : null;
  const target = preview ? targetOfPreview(preview, "dialog") : null;
  const { member, busy, error, join, open } = useInviteJoin(code, hash, target, { onDone: onClose });
  const headingId = useId();
  const isGroup = target?.kind === "group";
  const inviter = preview?.inviter;

  let content;
  if (entry?.status === "invalid") {
    content = (
      <InviteGone variant="dialog">
        <Button variant="secondary" block onClick={onClose}>{t("chat.attachments.close")}</Button>
      </InviteGone>
    );
  } else if (!target && entry?.status === "failed") {
    content = (
      <div className={s.view} data-variant="dialog" data-gone="true">
        <div className={s.gone}>
          <div className={s.goneText}>
            <h2 className={s.goneTitle}>{t("invite.couldNotLoadTheInvite")}</h2>
            <p className={s.goneBody}>{t("invite.checkYourConnection")}</p>
          </div>
        </div>
        <div className={s.goneMore}>
          <Button block onClick={() => void loadInvitePreview(code, { force: true })}>{t("invite.tryAgain")}</Button>
        </div>
      </div>
    );
  } else if (!target) {
    content = <InviteSkeleton variant="dialog" />;
  } else {
    content = (
      <InviteView
        target={target}
        variant="dialog"
        headingId={headingId}
        lead={inviter ? t("invite.invitedYouToJoin", { name: inviter.display_name || inviter.username }) : t("invite.youveBeenInvited")}
        actions={
          <>
            {member ? (
              <Button size="lg" block variant="secondary" onClick={open} data-testid="invite-open">{isGroup ? t("invite.openGroup") : t("invite.openServer")}</Button>
            ) : (
              <Button size="lg" block variant="positive" loading={busy} onClick={() => void join()} data-testid="invite-join">{isGroup ? t("invite.joinGroup") : t("invite.joinServer")}</Button>
            )}
            {error ? <p className={s.error} role="alert">{error}</p> : null}
          </>
        }
      >
        {!member && hash.includes("k=") ? <p className={s.note}><KeyRound size={14} aria-hidden="true" />{t("invite.thisLinkCarriesTheEncryptionKey")}</p> : null}
        {!member && isGroup ? <p className={s.note}><Lock size={14} aria-hidden="true" />{t("invite.groupChatsAreEndToEnd")}</p> : null}
      </InviteView>
    );
  }

  return (
    <Modal open bare onClose={onClose} width={440} ariaLabel={target?.name || t("invite.invite")}>
      <div className={s.dialog} data-testid="invite-dialog">
        <button className={s.close} onClick={onClose} aria-label={t("chat.attachments.close")}><X size={18} /></button>
        {content}
      </div>
    </Modal>
  );
}
