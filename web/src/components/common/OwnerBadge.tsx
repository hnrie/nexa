import { Crown, Hammer } from "lucide-react";
import { t } from "@/i18n";
import { Tooltip } from "./Tooltip";
import s from "./OwnerBadge.module.css";

/** The owner's crown: the same Crown icon used for server owners, cycling rainbow. */
export function OwnerCrown({ size = 14 }: { size?: number }) {
  return <Crown size={size} className={s.crown} aria-label={t("profile.profileCard.owner")} />;
}

/** The owner's badge: crown plus "Owner" in animated rainbow text. */
export function OwnerBadge() {
  return (
    <Tooltip text={t("profile.profileCard.ownerTip")} side="top">
      <span className={s.badge} tabIndex={0} data-testid="owner-badge">
        <OwnerCrown size={12} />
        <span className={s.text}>{t("profile.profileCard.owner")}</span>
      </span>
    </Tooltip>
  );
}

/** A Nexa admin's mark: a hammer, cycling the rainbow the way the owner's crown does. */
export function AdminHammer({ size = 14 }: { size?: number }) {
  return <Hammer size={size} className={s.hammer} role="img" aria-label={t("profile.profileCard.admin")} />;
}

/** A Nexa admin's badge: the hammer plus "Admin" in animated rainbow text. */
export function AdminBadge() {
  return (
    <Tooltip text={t("profile.profileCard.adminTip")} side="top">
      <span className={s.badge} tabIndex={0} data-testid="admin-badge">
        <AdminHammer size={12} />
        <span className={s.text}>{t("profile.profileCard.admin")}</span>
      </span>
    </Tooltip>
  );
}
