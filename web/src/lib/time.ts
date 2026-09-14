const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });
const longDateFmt = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function formatTime(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** "Today at 4:10 PM", "Yesterday at 9:02 AM", or "09/11/2026 4:10 PM". */
export function formatTimestamp(ms: number, now = Date.now()): string {
  if (sameDay(ms, now)) return `Today at ${formatTime(ms)}`;
  if (sameDay(ms, now - 86_400_000)) return `Yesterday at ${formatTime(ms)}`;
  return `${dateFmt.format(new Date(ms))} ${formatTime(ms)}`;
}

export function formatDateDivider(ms: number): string {
  return longDateFmt.format(new Date(ms));
}

export function formatFull(ms: number): string {
  return fullFmt.format(new Date(ms));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString();
}
