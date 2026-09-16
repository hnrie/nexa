/**
 * The one line under someone's name: their custom status, or what they are
 * doing. Either way, an icon for the kind of activity they have sits at the
 * end of it, so a game and a song are told apart at a glance, and the name of
 * what they are doing carries the weight.
 */
import { Gamepad2, Music, Trophy, Tv } from "lucide-react";
import { Twemoji } from "@/components/common/Twemoji";
import type { Activity } from "@/api/types";
import { activityParts } from "@/lib/activity";
import s from "./Activity.module.css";

const ICON: Record<number, typeof Music> = { 0: Gamepad2, 2: Music, 3: Tv, 5: Trophy };
const LABEL: Record<number, string> = { 0: "Playing a game", 2: "Listening to music", 3: "Watching", 5: "Competing" };

export function ActivityIcon({ type, size = 12 }: { type: number; size?: number }) {
  const Icon = ICON[type] ?? Gamepad2;
  return <Icon size={size} className={s.kindIcon} aria-label={LABEL[type] ?? "Activity"} />;
}

export function StatusLine({
  status,
  activity,
  className,
  testId,
}: {
  status?: { text: string; emoji: string } | null;
  activity?: Activity;
  className?: string;
  testId?: string;
}) {
  if (!status?.text && !status?.emoji && !activity) return null;
  const parts = activity ? activityParts(activity) : null;
  return (
    <span className={[s.statusLine, className].filter(Boolean).join(" ")} data-testid={testId}>
      <span className={s.statusText}>
        {status?.emoji ? <Twemoji text={status.emoji} className={s.statusEmoji} /> : null}
        {status?.text
          ? status.text
          : parts ? (
            <>
              {parts.verb} <b className={s.activityName}>{parts.name}</b>
            </>
          ) : null}
      </span>
      {activity ? <ActivityIcon type={activity.type} /> : null}
    </span>
  );
}
