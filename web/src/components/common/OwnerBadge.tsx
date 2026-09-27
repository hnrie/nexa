import { Crown, Hammer, Wrench } from "lucide-react";
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

/**
 * An instance admin's mark: a hammer and a wrench crossed, like the 🛠️
 * emoji, cycling the rainbow the way the owner's crown does.
 */
export function AdminTools({ size = 14 }: { size?: number }) {
  return (
    <span className={s.tools} style={{ width: size, height: size }} role="img" aria-label={t("profile.profileCard.admin")}>
      <Hammer size={size} aria-hidden="true" />
      <Wrench size={size} aria-hidden="true" className={s.mirror} />
    </span>
  );
}

/** An instance admin's badge: the crossed tools plus "Admin" in animated rainbow text. */
export function AdminBadge() {
  return (
    <span className={s.badge}>
      <AdminTools size={12} />
      <span className={s.text}>{t("profile.profileCard.admin")}</span>
    </span>
  );
}
