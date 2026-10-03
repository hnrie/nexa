import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import { Popout } from "@/components/common/Popout";
import { useIsMobile } from "@/hooks/useIsMobile";
import { closeProfilePopout, useProfilePopout } from "@/stores/profilePopout";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { ProfileCard } from "./ProfileCard";
import s from "./Profile.module.css";

/**
 * Where a profile popout is drawn: beside what opened it on a computer, and
 * as a sheet from the bottom on a phone, where nothing is wide enough to sit
 * beside.
 */
export function ProfilePopoutHost() {
  const open = useProfilePopout((x) => x.open);
  const mobile = useIsMobile();
  const name = useUsers((u) => (open ? displayName(u.byId[open.userId]) : ""));
  const { pathname } = useLocation();
  const dialogs = useUI((u) => u.modals.length);
  const seenDialogs = useRef(dialogs);
  // a dialog opened from it (a block, a nickname) would open behind it, so it makes way
  useEffect(() => {
    if (dialogs > seenDialogs.current) closeProfilePopout();
    seenDialogs.current = dialogs;
  }, [dialogs]);
  // and it belongs to the page it was opened on
  useEffect(() => closeProfilePopout(), [pathname]);
  if (!open) return null;
  const card = <ProfileCard key={open.userId} userId={open.userId} variant="popout" serverId={open.serverId} onClose={closeProfilePopout} />;
  if (mobile) {
    return (
      <Modal open onClose={closeProfilePopout} bare width={480} ariaLabel={name}>
        {card}
      </Modal>
    );
  }
  return (
    <Popout anchor={open.anchor} onClose={closeProfilePopout} label={name} prefer="side" className={s.popoutFrame} testId="profile-popout">
      {card}
    </Popout>
  );
}
