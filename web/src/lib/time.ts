/**
 * Dates and times, in the language the app is set to.
 *
 * Intl is given the app's tag rather than `undefined`, which would follow the
 * browser: someone reading Nexa in Arabic on an English system wants Arabic
 * months beside Arabic words, not a line that changes language halfway. The
 * formatters are built once per language and kept, since building one is the
 * expensive part and a message list asks for hundreds.
 */
import { t, translator } from "@/i18n";

/** The styles a `<t:…>` timestamp in a message can ask for, beside the app's own. */
export type StampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

type Kind = "time" | "date" | "longDate" | "full" | `stamp:${Exclude<StampStyle, "R">}`;

const OPTIONS: Record<Kind, Intl.DateTimeFormatOptions> = {
  time: { hour: "numeric", minute: "2-digit" },
  date: { month: "2-digit", day: "2-digit", year: "numeric" },
  longDate: { month: "long", day: "numeric", year: "numeric" },
  full: { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
  "stamp:t": { hour: "numeric", minute: "2-digit" },
  "stamp:T": { hour: "numeric", minute: "2-digit", second: "2-digit" },
  "stamp:d": { year: "numeric", month: "2-digit", day: "2-digit" },
  "stamp:D": { year: "numeric", month: "long", day: "numeric" },
  "stamp:f": { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  "stamp:F": { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
};

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(kind: Kind): Intl.DateTimeFormat {
  const locale = translator().locale;
  const key = `${locale}:${kind}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, OPTIONS[kind]);
    } catch {
      f = new Intl.DateTimeFormat(undefined, OPTIONS[kind]);
    }
    cache.set(key, f);
  }
  return f;
}

export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function formatTime(ms: number): string {
  return fmt("time").format(new Date(ms));
}

/** "Today at 4:10 PM", "Yesterday at 9:02 AM", or "09/11/2026 4:10 PM". */
export function formatTimestamp(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return t("time.todayAt", { time: formatTime(ms) });
  // the calendar's yesterday: 24 hours back lands on the wrong day around a
  // daylight-saving change
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(ms, yesterday.getTime())) return t("time.yesterdayAt", { time: formatTime(ms) });
  return t("time.dateAt", { date: fmt("date").format(new Date(ms)), time: formatTime(ms) });
}

export function formatDateDivider(ms: number): string {
  return fmt("longDate").format(new Date(ms));
}

export function formatFull(ms: number): string {
  return fmt("full").format(new Date(ms));
}

/** A size rounded the way it is shown, so the language formats the digits. */
const round = (v: number, places: number): number => Number(v.toFixed(places));

/**
 * A short span in the reader's language — "5s", "2m", "1h" in English,
 * "5 с", "2 мин" in Russian — for slow mode and anything else that counts in
 * whole seconds, minutes or hours. Whole minutes and hours read as those.
 */
export function formatShortDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const [value, unit] = s >= 3600 && s % 3600 === 0 ? [s / 3600, "hour"] : s >= 60 && s % 60 === 0 ? [s / 60, "minute"] : [s, "second"];
  try {
    return new Intl.NumberFormat(translator().locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  } catch {
    return `${value}${unit[0]}`;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return t("time.bytes", { n });
  if (n < 1024 * 1024) return t("time.kilobytes", { n: round(n / 1024, 1) });
  if (n < 1024 * 1024 * 1024) return t("time.megabytes", { n: round(n / (1024 * 1024), 1) });
  return t("time.gigabytes", { n: round(n / (1024 * 1024 * 1024), 2) });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31557600],
  ["month", 2629800],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

const relCache = new Map<string, Intl.RelativeTimeFormat>();

function relFmt(): Intl.RelativeTimeFormat {
  const locale = translator().locale;
  let f = relCache.get(locale);
  if (!f) {
    try {
      f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    } catch {
      f = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    }
    relCache.set(locale, f);
  }
  return f;
}

/**
 * A `<t:…>` timestamp written in a message, in the app's language.
 *
 * These used to build two Intl formatters per timestamp per render and pass
 * `undefined` for the locale, which means the browser's: Arabic words with an
 * English date in the middle of them, which is the exact thing this file
 * exists to avoid.
 */
export function formatStamp(date: Date, style: StampStyle): string {
  if (style !== "R") return fmt(`stamp:${style}`).format(date);
  const delta = date.getTime() / 1000 - Date.now() / 1000;
  const abs = Math.abs(delta);
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds || unit === "second") return relFmt().format(Math.round(delta / seconds), unit);
  }
  return "";
}

/** "just now", "5 minutes ago", "2 hours ago", or the date for anything older than a day. */
export function formatRelative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutesAgo", { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hoursAgo", { count: h });
  return fmt("date").format(new Date(ms));
}
