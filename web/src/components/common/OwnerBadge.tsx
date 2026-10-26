import { Gem, Heart } from "lucide-react";
import type { Plan } from "@/api/types";
import { t } from "@/i18n";
import { RANK_ICON, rankName, rankOf, rankTip, type StaffRank } from "@/lib/staffRank";
import { useOwnerId } from "@/lib/owner";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { Tooltip } from "./Tooltip";
import s from "./OwnerBadge.module.css";

/**
 * A member of Nexa's staff's mark: the owner's crown, a developer's code
 * brackets, an admin's hammer, a mod's shield, all in the accent. A server
 * owner's crown stays gold elsewhere: it is a different thing to be.
 */
export function StaffMark({ rank, size = 14 }: { rank: StaffRank; size?: number }) {
  const Icon = RANK_ICON[rank];
  return <Icon size={size} className={s.mark} role="img" aria-label={rankName(rank)} data-rank={rank} />;
}

/** The mark of someone's rank in a list, from what this device knows of them; nothing for anyone else. */
export function RankMark({ userId, size = 14 }: { userId: string; size?: number }) {
  const owner = useOwnerId();
  const flags = useUsers((u) => u.byId[userId]?.flags);
  const mine = useAuth((a) => (a.me?.id === userId ? a.me.flags : undefined));
  const rank = rankOf(userId, mine ?? flags, owner);
  return rank ? <StaffMark rank={rank} size={size} /> : null;
}

/** A member of staff's badge on a profile: the mark and the rank's name on a pill in the accent. */
export function StaffBadge({ rank }: { rank: StaffRank }) {
  return (
    <Tooltip text={rankTip(rank)} side="top">
      <span className={s.badge} tabIndex={0} data-testid={`${rank}-badge`}>
        <StaffMark rank={rank} size={12} />
        <span className={s.text}>{rankName(rank)}</span>
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
