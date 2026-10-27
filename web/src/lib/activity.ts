/**
 * How a Rich Presence activity reads: the one line under someone's name, the
 * card's heading, and its clock (a progress bar for music and video, time
 * spent for anything else), all the way Discord shows them.
 */
import type { Activity } from "@/api/types";

import { t } from "@/i18n";

/**
 * "Listening to Rick Astley", with the name where the language puts it: a
 * sentence built as verb-then-name read "再生中 Rick Astley" in Japanese,
 * which says it the other way round. Built per call, so it follows the language.
 */
function lineFor(type: number, name: string): string {
  switch (type) {
    case 1:
      return t("activity.streamingName", { name });
    case 2:
      return t("activity.listeningToName", { name });
    case 3:
      return t("activity.watchingName", { name });
    case 5:
      return t("activity.competingInName", { name });
    default:
      return t("activity.playingName", { name });
  }
}

/** Spotify, which Discord passes on with the song in `details` and its artists in `state`. */
export function isSpotify(a: Activity): boolean {
  return a.type === 2 && a.name.trim().toLowerCase() === "spotify";
}

/**
 * The name an activity shows: whichever field the program asked to be shown.
 * A Spotify song that asks for nothing in particular shows its artists, since
 * "Spotify" under someone's name says only which app is playing.
 */
export function activityParts(a: Activity): { name: string } {
  const shown = a.status_display_type ?? (isSpotify(a) ? 1 : 0);
  const text = shown === 1 ? a.state : shown === 2 ? a.details : undefined;
  return { name: text || a.name };
}

/** "Listening to Rick Astley": the summary shown under a name in lists. */
export function activityLine(a: Activity): string {
  return lineFor(a.type, activityParts(a).name);
}

/** The card's heading: "Listening to Music Player", or "Playing a game". */
export function activityHeading(a: Activity): string {
  return a.type === 0 ? t("activity.statusLine.playingAGame") : lineFor(a.type, a.name);
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

/** An activity is supplied by someone else; never hand arbitrary schemes to the OS. */
export function activityDestination(raw?: string): { href: string; host: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return { href: url.href, host: url.host };
  } catch { return null; }
}
