/**
 * The one line under someone's name.
 *
 * The icon for what they are doing comes first, so a song and a game are told
 * apart before a word is read. After it comes whichever they have: the status
 * they wrote, or the name of what they are playing. Someone with both gets the
 * icon and then their own words, which win the space.
 *
 * Long statuses scroll rather than ending in an ellipsis, since the part worth
 * reading is usually the part that got cut.
 */
import { Gamepad2, Music, Radio, Trophy, Tv } from "lucide-react";
import { ScrollingText } from "@/components/common/ScrollingText";
import type { Activity } from "@/api/types";
import { activityParts, isSpotify } from "@/lib/activity";
import s from "./Activity.module.css";
import { StatusEmoji } from "./StatusEmoji";

import { t } from "@/i18n";
const ICON: Record<number, typeof Music> = { 0: Gamepad2, 1: Radio, 2: Music, 3: Tv, 5: Trophy };
/** What each activity type is called, per render so it follows the language. */
const labels = (): Record<number, string> => ({ 0: t("activity.statusLine.playingAGame"), 1: t("activity.statusLine.streaming"), 2: t("activity.statusLine.listeningToMusic"), 3: t("activity.statusLine.watching"), 5: t("activity.statusLine.competing") });

/** A game's and a song's icon is green whatever app it comes from; `spotify` keeps Spotify's own green on its note. */
export function ActivityIcon({ type, size = 12, more = 0, spotify = false }: { type: number; size?: number; more?: number; spotify?: boolean }) {
  const Icon = ICON[type] ?? Gamepad2;
  const label = labels()[type] ?? t("settings.privacy.activity");
  if (more > 0) {
    return (
      // `aria-label` on a plain span is prohibited and is not announced; the
      // words go in a hidden one, which is read wherever text is read.
      <span className={s.kindStack} title={t("activity.statusLine.andMore", { what: label, count: more })}>
        <Icon size={size} className={s.kindIcon} data-kind={type} data-spotify={spotify || undefined} aria-hidden="true" />
        <span className={s.kindMore} aria-hidden="true">+{more}</span>
        <span className="visually-hidden">{t("activity.statusLine.andMore", { what: label, count: more })}</span>
      </span>
    );
  }
  return <Icon size={size} className={s.kindIcon} data-kind={type} data-spotify={spotify || undefined} role="img" aria-label={label} />;
}

export function StatusLine({
  status,
  activity,
  className,
  testId,
  more = 0,
}: {
  status?: { text: string; emoji: string } | null;
  activity?: Activity;
  className?: string;
  testId?: string;
  /** How many other activities they have besides this one. */
  more?: number;
}) {
  if (!status?.text && !status?.emoji && !activity) return null;
  const parts = activity ? activityParts(activity) : null;
  const words = status?.text || status?.emoji;
  return (
    <span className={[s.statusLine, className].filter(Boolean).join(" ")} data-testid={testId}>
      {activity ? <ActivityIcon type={activity.type} more={more} spotify={isSpotify(activity)} /> : null}
      <ScrollingText className={s.statusText}>
        {words ? (
          <>
            {status?.emoji ? <StatusEmoji emoji={status.emoji} className={s.statusEmoji} /> : null}
            {status?.text}
          </>
        ) : parts ? (
          <b className={s.activityName}>{parts.name}</b>
        ) : null}
      </ScrollingText>
    </span>
  );
}
