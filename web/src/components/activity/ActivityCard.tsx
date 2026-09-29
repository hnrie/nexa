import { Gamepad2, Music, Radio, Trophy, Tv } from "lucide-react";
import type { Activity } from "@/api/types";
import { useNow } from "@/hooks/useNow";
import { activityHeading, activityProgress, formatClock } from "@/lib/activity";
import s from "./Activity.module.css";

import { t } from "@/i18n";
/** Text that opens its link in a new tab when the activity gives one. */
function Linked({ href, className, title, children }: { href?: string | undefined; className?: string | undefined; title?: string | undefined; children: React.ReactNode }) {
  return href ? (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" title={title}>{children}</a>
  ) : (
    <span className={className} title={title}>{children}</span>
  );
}

function Fallback({ type }: { type: Activity["type"] }) {
  const Icon = type === 1 ? Radio : type === 2 ? Music : type === 3 ? Tv : type === 5 ? Trophy : Gamepad2;
  return <span className={s.fallback}><Icon size={32} /></span>;
}

/**
 * One activity the way Discord shows Rich Presence in a profile: its art, what
 * and where, a progress bar for music and video or the time spent, the party
 * size, and up to two buttons.
 */
export function ActivityCard({ activity: a }: { activity: Activity }) {
  const timed = !!(a.timestamps?.start || a.timestamps?.end);
  const now = useNow(timed);
  const clock = timed ? activityProgress(a, now) : null;
  const large = a.assets?.large_image || a.icon_url;
  // music, video and streams lead with the track or title; games with their name
  const media = a.type === 1 || a.type === 2 || a.type === 3;
  const title = media ? a.details || a.name : a.name;
  const lines: { text: string; href?: string | undefined; muted?: boolean }[] = [];
  if (media) {
    if (a.state) lines.push({ text: a.type === 2 ? t("activity.activityCard.byArtist", { name: a.state }) : a.state, href: a.state_url });
    if (a.assets?.large_text) lines.push({ text: a.type === 2 ? t("activity.activityCard.onAlbum", { name: a.assets.large_text }) : a.assets.large_text, href: a.assets.large_url, muted: true });
  } else {
    if (a.details) lines.push({ text: a.details, href: a.details_url });
    const party = a.party?.size ? t("activity.activityCard.partySize", { count: a.party.size[0], max: a.party.size[1] }) : "";
    if (a.state || party) lines.push({ text: [a.state ?? "", party].filter(Boolean).join(" "), href: a.state_url });
  }
  return (
    <div className={s.card} data-testid="activity-card">
      <h4 className={s.heading}>
        {activityHeading(a)}
        {a.source === "discord" ? <span className={s.source}>{t("activity.activityCard.fromDiscord")}</span> : null}
      </h4>
      <div className={s.row}>
        <div className={s.art}>
          {large ? (
            <Linked href={a.assets?.large_url} title={a.assets?.large_text}>
              <img className={s.large} src={large} alt={a.assets?.large_text ?? a.name} loading="lazy" draggable={false} />
            </Linked>
          ) : (
            <Fallback type={a.type} />
          )}
          {a.assets?.small_image ? (
            <Linked href={a.assets.small_url} title={a.assets.small_text}>
              <img className={s.small} src={a.assets.small_image} alt={a.assets.small_text ?? ""} loading="lazy" draggable={false} />
            </Linked>
          ) : null}
        </div>
        <div className={s.text}>
          <Linked href={media ? a.details_url : undefined} className={s.title} title={title}>{title}</Linked>
          {lines.map((l, i) => (
            <Linked key={i} href={l.href} className={[s.line, l.muted ? s.muted : ""].join(" ")} title={l.text}>{l.text}</Linked>
          ))}
          {clock?.kind === "remaining" ? <span className={s.clock}>{t("activity.activityCard.timeLeft", { time: formatClock(clock.remaining) })}</span> : null}
          {clock?.kind === "elapsed" ? <span className={s.clock}>{t("activity.activityCard.timeElapsed", { time: formatClock(clock.elapsed) })}</span> : null}
        </div>
      </div>
      {clock?.kind === "progress" ? (
        <div className={s.progress} data-testid="activity-progress">
          <span>{formatClock(clock.elapsed)}</span>
          <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(clock.total / 1000)} aria-valuenow={Math.round(clock.elapsed / 1000)} aria-label={t("activity.activityCard.playback")}>
            <i style={{ width: `${clock.fraction * 100}%` }} />
          </div>
          <span>{formatClock(clock.total)}</span>
        </div>
      ) : null}
      {a.buttons?.length ? (
        <div className={s.buttons}>
          {a.buttons.map((b) => (
            <a key={b.url + b.label} className={s.button} href={b.url} target="_blank" rel="noopener noreferrer">{b.label}</a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Every activity of someone, newest first. */
export function ActivityList({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;
  return (
    <div className={s.list}>
      {activities.map((a) => (
        <ActivityCard key={`${a.application_id ?? ""}:${a.name}:${a.created_at}`} activity={a} />
      ))}
    </div>
  );
}
