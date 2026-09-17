/**
 * How a Rich Presence activity reads: the one line under someone's name, the
 * card's heading, and its clock (a progress bar for music and video, time
 * spent for anything else), all the way Discord shows them.
 */
import type { Activity } from "@/api/types";

import { t } from "@/i18n";
/** The verb each activity type reads with, per call so it follows the language. */
const verbs = (): Record<number, string> => ({ 0: t("activity.playing"), 2: t("activity.listeningTo"), 3: t("activity.watching"), 5: t("activity.competingIn") });

export function activityVerb(a: Pick<Activity, "type">): string {
  return verbs()[a.type] ?? t("activity.playing");
}

/**
 * "Listening to" and "Rick Astley" apart, so a list can weight the name on its
 * own. The name is whichever field the program asked to be shown.
 */
export function activityParts(a: Activity): { verb: string; name: string } {
  const text = a.status_display_type === 1 ? a.state : a.status_display_type === 2 ? a.details : undefined;
  return { verb: activityVerb(a), name: text || a.name };
}

/** "Listening to Rick Astley": the summary shown under a name in lists. */
export function activityLine(a: Activity): string {
  const { verb, name } = activityParts(a);
  return `${verb} ${name}`;
}

/** The card's heading: "Listening to Music Player", or "Playing a game". */
export function activityHeading(a: Activity): string {
  return a.type === 0 ? "Playing a game" : `${activityVerb(a)} ${a.name}`;
}

export type ActivityClock =
  | { kind: "progress"; elapsed: number; total: number; fraction: number }
  | { kind: "elapsed"; elapsed: number }
  | { kind: "remaining"; remaining: number };

/** Where an activity's clock stands at `now`, or null when it has none. */
export function activityProgress(a: Activity, now: number): ActivityClock | null {
  const { start, end } = a.timestamps ?? {};
  if (start !== undefined && end !== undefined && end > start && (a.type === 2 || a.type === 3)) {
    const total = end - start;
    const elapsed = Math.min(total, Math.max(0, now - start));
    return { kind: "progress", elapsed, total, fraction: elapsed / total };
  }
  if (start !== undefined) return { kind: "elapsed", elapsed: Math.max(0, now - start) };
  if (end !== undefined) return { kind: "remaining", remaining: Math.max(0, end - now) };
  return null;
}

/** 1:05, or 1:02:05 past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
