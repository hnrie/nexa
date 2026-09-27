import { Crown, Shield } from "lucide-react";
import { t } from "@/i18n";
import s from "./OwnerBadge.module.css";

/** The owner's crown: the same Crown icon used for server owners, cycling rainbow. */
export function OwnerCrown({ size = 14 }: { size?: number }) {
  return <Crown size={size} className={s.crown} aria-label={t("profile.profileCard.owner")} />;
}

/** The owner's badge: crown plus "Owner" in animated rainbow text. */
export function OwnerBadge() {
  return (
    <span className={s.badge}>
      <OwnerCrown size={12} />
      <span className={s.text}>{t("profile.profileCard.owner")}</span>
    </span>
  );
}

/** An instance admin's mark: a shield, cycling the rainbow the way the owner's crown does. */
export function AdminShield({ size = 14 }: { size?: number }) {
  return <Shield size={size} className={s.shield} role="img" aria-label={t("profile.profileCard.admin")} />;
}

/** An instance admin's badge: the shield plus "Admin" in animated rainbow text. */
export function AdminBadge() {
  return (
    <span className={s.badge}>
      <AdminShield size={12} />
      <span className={s.text}>{t("profile.profileCard.admin")}</span>
    </span>
  );
}
