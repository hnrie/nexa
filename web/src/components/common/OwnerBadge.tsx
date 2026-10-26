import { Crown, Gem, Hammer, Heart } from "lucide-react";
import type { Plan } from "@/api/types";
import { t } from "@/i18n";
import { Tooltip } from "./Tooltip";
import s from "./OwnerBadge.module.css";

/** The owner's crown: the Crown icon server owners have, in the accent rather than gold. */
export function OwnerCrown({ size = 14 }: { size?: number }) {
  return <Crown size={size} className={s.crown} aria-label={t("profile.profileCard.owner")} />;
}

/** The owner's badge: the crown and "Owner" on a pill in the accent, as the admin panel draws staff. */
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

/** A Nexa admin's mark: a hammer, in the accent as the owner's crown is. */
export function AdminHammer({ size = 14 }: { size?: number }) {
  return <Hammer size={size} className={s.hammer} role="img" aria-label={t("profile.profileCard.admin")} />;
}

/** A Nexa admin's badge: the hammer and "Admin" on the same pill as the owner's. */
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

/**
 * The badge of someone's subscription: a heart for Supporter, a gem for Pro,
 * each in its plan's own light (--tier-* in tokens.css). Nothing on the free plan.
 */
export function PlanBadge({ plan }: { plan: Plan | undefined }) {
  if (plan !== "supporter" && plan !== "pro") return null;
  const Icon = plan === "pro" ? Gem : Heart;
  const name = plan === "pro" ? t("support.plan.pro") : t("support.plan.supporter");
  return (
    <Tooltip text={plan === "pro" ? t("support.badge.proTip") : t("support.badge.supporterTip")} side="top">
      <span className={s.badge} data-plan={plan} tabIndex={0} data-testid="plan-badge">
        <Icon size={12} aria-hidden="true" />
        <span className={s.text}>{name}</span>
      </span>
    </Tooltip>
  );
}
