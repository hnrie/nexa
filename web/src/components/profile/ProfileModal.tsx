import { useEffect, useState } from "react";
import { users as usersApi } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { ProfileCard } from "./ProfileCard";
import s from "./Profile.module.css";

export default function ProfileModal({ onClose, userId }: { onClose: () => void; userId: string }) {
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
      <Modal open onClose={onClose} title="Profile">
        <p className={s.small}>Could not load this profile.</p>
        <Button size="sm" onClick={() => { setLoadError(false); setRetry((r) => r + 1); }}>Retry</Button>
      </Modal>
    );
  }
  if (!known) return <Modal open onClose={onClose} title="Profile"><p className={s.small}>Loading…</p></Modal>;
  return (
    <Modal open onClose={onClose} width={600} bare>
      <ProfileCard userId={userId} variant="modal" onClose={onClose} />
    </Modal>
  );
}
