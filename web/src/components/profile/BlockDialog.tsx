import { PersonName } from "@/components/common/PersonName";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { blockUser } from "@/lib/friendship";
import { describeError } from "@/lib/errors";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Block.module.css";

import { t, Tr } from "@/i18n";

/**
 * The one way to block someone, wherever Block was chosen: what it does, and
 * the two choices about their messages, filled in from the account's own.
 * They are the account's choices rather than this person's, and the dialog
 * says so: Settings > Blocked users is where they are changed later.
 */
export function BlockDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const stored = useUsers((u) => u.byId[userId]);
  const relUser = useRelationships((r) => r.byUser[userId]?.user);
  const user = stored ?? relUser;
  const current = useSettings((st) => st.settings.blocking);
  const [hide, setHide] = useState(current.hideMessages);
  const [replies, setReplies] = useState(current.hideMessages && current.hideReplies);
  const [busy, setBusy] = useState(false);
  const name = displayName(user);

  const block = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      await blockUser(user, { hideMessages: hide, hideReplies: hide && replies });
      onClose();
    } catch (err) {
      useUI.getState().toast(describeError(err, t("people.block.couldNotBlock")), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={<Tr id="people.block.title" values={{ name: <PersonName userId={userId} user={user}>{name}</PersonName> }} />}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button variant="danger" loading={busy} disabled={!user} onClick={() => void block()} data-testid="block-confirm">{t("profile.profileCard.block")}</Button>
        </>
      }
    >
      <p className={s.body}>{t("people.block.body")}</p>
      <div className={s.choices} role="group" aria-label={t("people.blockedPage.messagesHeading")}>
        <label className={s.choice}>
          <input
            type="checkbox"
            checked={hide}
            onChange={(e) => {
              setHide(e.target.checked);
              if (!e.target.checked) setReplies(false);
            }}
            data-testid="block-hide-messages"
          />
          <span className={s.choiceText}>
            <span className={s.choiceLabel}>{t("people.block.hideMessages")}</span>
            <span className={s.choiceHint}>{t("people.block.hideMessagesHint")}</span>
          </span>
        </label>
        {/* only meaningful once their own messages are gone, so it sits under that choice */}
        <label className={s.choice} data-nested="" data-disabled={!hide || undefined}>
          <input type="checkbox" checked={hide && replies} disabled={!hide} onChange={(e) => setReplies(e.target.checked)} data-testid="block-hide-replies" />
          <span className={s.choiceText}>
            <span className={s.choiceLabel}>{t("people.block.hideReplies")}</span>
            <span className={s.choiceHint}>{t("people.block.hideRepliesHint")}</span>
          </span>
        </label>
      </div>
      <p className={s.note}>{t("people.block.appliesToAll")}</p>
    </Modal>
  );
}
