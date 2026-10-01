import { Play, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { t } from "@/i18n";
import { formatDuration } from "@/lib/time";
import s from "./YouTubePlayer.module.css";

/**
 * A YouTube video, played through this server (internal/api/youtube_proxy.go):
 * YouTube never sees who is watching. The frame is sandboxed without its own
 * origin, so the player's code cannot reach anything of the app's, and its
 * policy lets it talk to this server's /yt/ path and nothing else.
 */
export function YouTubeFrame({ id, title, start }: { id: string; title: string; start?: number | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const at = start && start > 0 ? `?start=${Math.floor(start)}` : "";
    api
      .request<{ url: string }>("GET", `/youtube/${encodeURIComponent(id)}${at}`)
      .then((r) => alive && r?.url.startsWith("/yt/") && setSrc(api.baseUrl + r.url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id, start]);
  if (failed) return <div className={s.note}>{t("chat.embeds.playerFailed")}</div>;
  if (!src) return <div className={s.note} aria-busy="true" />;
  return (
    <iframe
      className={s.frame}
      src={src}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-presentation"
      referrerPolicy="no-referrer"
      data-testid="youtube-frame"
    />
  );
}

/** The 11 characters YouTube names a video by. */
export function isYouTubeID(id: string | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

interface VideoProps {
  id: string;
  title: string;
  /** Its picture, already a proxy address. */
  poster: string | null | undefined;
  start?: number | undefined;
  duration?: number | undefined;
  live?: "now" | "upcoming" | undefined;
  w?: number | undefined;
  h?: number | undefined;
}

/**
 * A YouTube video's picture, with how long it runs and whether it is live,
 * that becomes the player when pressed. Nothing of YouTube's loads before
 * then; the picture comes through this server's proxy like every other.
 */
export function YouTubeVideo({ id, title, poster, start, duration, live, w, h }: VideoProps) {
  const [play, setPlay] = useState(false);
  // a Short stands up; everything else is the 16:9 YouTube plays at
  const tall = !!w && !!h && h > w;
  return (
    <div className={s.video} data-tall={tall || undefined} data-testid="youtube-video">
      {play ? (
        <YouTubeFrame id={id} title={title} start={start} />
      ) : (
        <button type="button" className={s.poster} onClick={() => setPlay(true)} aria-label={t("chat.embeds.playVideoNamed", { name: title })}>
          {poster ? <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={(ev) => (ev.currentTarget.style.visibility = "hidden")} /> : null}
          <span className={s.play} aria-hidden="true">
            <Play size={26} fill="currentColor" />
          </span>
          {live === "now" ? (
            <span className={s.badge} data-live="true">
              <Radio size={13} aria-hidden="true" /> {t("chat.embeds.live")}
            </span>
          ) : live === "upcoming" ? (
            <span className={s.badge}>{t("chat.embeds.upcoming")}</span>
          ) : duration && duration > 0 ? (
            <span className={s.badge}>{formatDuration(duration)}</span>
          ) : null}
        </button>
      )}
    </div>
  );
}
