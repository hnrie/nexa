import { useEffect, useState } from "react";
import { users as usersApi } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { ProfileCard, type ProfileTab } from "./ProfileCard";
import { isSystemAccount } from "@/lib/moderation";
import s from "./Profile.module.css";

import { t } from "@/i18n";
/**
 * Someone's profile in a dialog: the mini profile a name or a picture opens,
 * as the profile dialog has always looked, or (full) the whole profile, two
 * columns with its tabs, which the mini one's View Full Profile opens.
 */
export default function ProfileModal({ onClose, userId, tab, full }: { onClose: () => void; userId: string; tab?: ProfileTab | undefined; full?: boolean }) {
  const me = useAuth((a) => a.me);
  const stored = useUsers((u) => u.byId[userId]);
  const upsertUser = useUsers((u) => u.upsert);
  const known = me?.id === userId || !!stored;
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  // the card fetches the full profile itself; this only notices that there is nothing to show at all
  useEffect(() => {
    if (known) return;
    let alive = true;
    usersApi
      .profile(userId)
      .then((p) => alive && upsertUser(p.user))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [userId, known, upsertUser, retry]);

  if (!known && loadError) {
    return (
      <Modal open onClose={onClose} title={t("profile.profile.profile")}>
        <p className={s.small}>{t("profile.profile.couldNotLoadThisProfile")}</p>
        <Button size="sm" onClick={() => { setLoadError(false); setRetry((r) => r + 1); }}>{t("chat.messageItem.retry")}</Button>
      </Modal>
    );
  }
  if (!known) return <Modal open onClose={onClose} title={t("profile.profile.profile")}><p className={s.small}>{t("chat.pins.loading")}</p></Modal>;
  // a person's full profile is two columns wide; the system account's card is its own, and narrower
  const wide = (full || !!tab) && !(stored && isSystemAccount(stored.flags));
  return (
    <Modal open onClose={onClose} width={wide ? 940 : 600} bare ariaLabel={stored?.display_name || stored?.username || t("names.unknownUser")}>
      <ProfileCard userId={userId} variant={wide ? "modal" : "mini"} onClose={onClose} initialTab={tab} />
    </Modal>
  );
}
