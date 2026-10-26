import type { ModUser } from "@/api/moderation";
import type { Activity, Presence } from "@/api/types";
import { StatusEmoji } from "@/components/activity/StatusEmoji";
import { ActivityIcon } from "@/components/activity/StatusLine";
import { statusLabel } from "@/components/common/Avatar";
import { activityLine, isSpotify } from "@/lib/activity";
import { activitiesOf, customStatus } from "@/stores/presence";
import { RANK_ICON, rankName, type StaffRank } from "@/lib/staffRank";
import m from "./Moderation.module.css";

export type ModStatus = { status: "online" | "idle" | "dnd" | "offline"; custom: { text: string; emoji: string } | null; activities: Activity[] };

/**
 * Where someone stands right now, for the staff: the live presence when this
 * account can see it (they share a server or are friends), and otherwise the
 * one the grid loaded. The custom status is theirs to moderate, so it shows
 * even while they are away, unless it has run out.
 */
export function modStatus(u: ModUser, live: Presence | undefined, now = Date.now()): ModStatus {
  if (live && live.status !== "offline" && live.status !== "invisible") {
    return { status: live.status, custom: customStatus(live), activities: activitiesOf(live) };
  }
  const expired = u.status_expires_at !== null && u.status_expires_at < now;
  const custom = !expired && (u.status_text || u.status_emoji) ? { text: u.status_text, emoji: u.status_emoji } : null;
  const snap = u.presence;
  const status = live ? "offline" : (snap?.status ?? "offline");
  return { status, custom, activities: status === "offline" ? [] : (snap?.activities ?? []) };
}

/** The presence, the custom status and what they are doing, as the grid and a person's page show them. */
export function StatusSummary({ st, compact = false }: { st: ModStatus; compact?: boolean }) {
  const first = st.activities[0];
  return (
    <div className={m.statusBox} data-compact={compact || undefined} data-testid="mod-status">
      <span className={m.presence} data-status={st.status}>
        <i aria-hidden="true" />
        {statusLabel(st.status)}
      </span>
      {st.custom ? (
        <span className={m.custom} title={[st.custom.emoji, st.custom.text].filter(Boolean).join(" ")} data-testid="mod-custom-status">
          {st.custom.emoji ? <StatusEmoji emoji={st.custom.emoji} className={m.customEmoji} /> : null}
          <span className={m.customText}>{st.custom.text}</span>
        </span>
      ) : null}
      {first ? (
        <span className={m.activity} title={activityLine(first)} data-testid="mod-activity">
          <ActivityIcon type={first.type} size={13} more={Math.max(0, st.activities.length - 1)} spotify={isSpotify(first)} />
          <span className={m.activityText}>{activityLine(first)}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Someone's staff rank as the panel shows it beside their name. */
export function RankPill({ rank }: { rank: StaffRank }) {
  const Icon = RANK_ICON[rank];
  return (
    <span className={m.staffBadge} data-rank={rank}>
      <Icon size={12} aria-hidden="true" />
      {rankName(rank)}
    </span>
  );
}
