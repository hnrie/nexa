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

type Kind = "time" | "date" | "longDate" | "full";

const OPTIONS: Record<Kind, Intl.DateTimeFormatOptions> = {
  time: { hour: "numeric", minute: "2-digit" },
  date: { month: "2-digit", day: "2-digit", year: "numeric" },
  longDate: { month: "long", day: "numeric", year: "numeric" },
  full: { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
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
  if (sameDay(ms, now - 86_400_000)) return t("time.yesterdayAt", { time: formatTime(ms) });
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
