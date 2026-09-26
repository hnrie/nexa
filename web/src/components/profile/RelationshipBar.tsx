import { Ban, Clock, UserPlus } from "lucide-react";
import type { PublicUser, Relationship } from "@/api/types";
import { acceptFriendRequest, dropFriendRequest, unblockUser, useBusyWith } from "@/lib/friendship";
import s from "./Profile.module.css";

import { t } from "@/i18n";

/** What the bar says for each state, which the card also reads out when it changes. */
export function relationshipLine(rel: Relationship | undefined): string {
  if (rel?.type === "incoming") return t("friends.incomingFriendRequest");
  if (rel?.type === "outgoing") return t("friends.outgoingFriendRequest");
  if (rel?.type === "blocked") return t("people.request.blocked");
  return "";
}

/**
 * Where things stand with someone who is not (yet) a friend, on their
 * profile: a request they sent, with Accept and Ignore; one you sent, with a
 * way to take it back; or a block, with Unblock. The preview beside a DM used
 * to show nothing at all once a request was sent, so it looked as if it had
 * never gone.
 */
export function RelationshipBar({ user, rel }: { user: PublicUser; rel: Relationship | undefined }) {
  const busy = useBusyWith(user.id);
  if (!rel || rel.type === "friend") return null;
  const Icon = rel.type === "incoming" ? UserPlus : rel.type === "outgoing" ? Clock : Ban;
  return (
    <div className={s.request} data-kind={rel.type} data-testid="profile-request">
      <Icon size={16} className={s.requestIcon} aria-hidden="true" />
      <span className={s.requestText}>{relationshipLine(rel)}</span>
      <span className={s.requestBtns}>
        {rel.type === "incoming" ? (
          <>
            <button type="button" className={s.requestBtn} data-primary="" disabled={busy} onClick={() => void acceptFriendRequest(user)} data-testid="profile-request-accept">{t("people.request.accept")}</button>
            <button type="button" className={s.requestBtn} disabled={busy} onClick={() => void dropFriendRequest(user.id)} aria-label={t("people.menu.ignoreRequest")} data-testid="profile-request-ignore">{t("friends.ignore")}</button>
          </>
        ) : rel.type === "outgoing" ? (
          <button type="button" className={s.requestBtn} disabled={busy} onClick={() => void dropFriendRequest(user.id)} aria-label={t("people.menu.cancelRequest")} data-testid="profile-request-cancel">{t("people.request.cancel")}</button>
        ) : (
          <button type="button" className={s.requestBtn} disabled={busy} onClick={() => void unblockUser(user.id)} data-testid="profile-request-unblock">{t("friends.unblock")}</button>
        )}
      </span>
    </div>
  );
}
