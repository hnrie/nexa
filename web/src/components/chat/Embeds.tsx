import { Play, Star } from "lucide-react";
import { useState } from "react";
import type { UnfurlResult } from "@/api/types";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Embeds.module.css";

function fit(w: number | undefined, h: number | undefined, maxW = 400, maxH = 300): { width: number; height: number } | undefined {
  if (!w || !h) return undefined;
  const r = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

/** Saves the proxied URL, so favourites load through this server too. */
export function FavoriteButton({ url, w, h }: { url: string; w?: number; h?: number }) {
  const favs = useSettings((st) => st.settings.favoriteGifs);
  const patch = useSettings((st) => st.patch);
  const toast = useUI((u) => u.toast);
  const on = favs.some((f) => f.url === url);
  return (
    <button
      className={s.star}
      data-on={on}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.stopPropagation();
        const next = on ? favs.filter((f) => f.url !== url) : [{ url, ...(w ? { w } : {}), ...(h ? { h } : {}) }, ...favs].slice(0, 500);
        patch({ favoriteGifs: next });
        toast(on ? "Removed from favorites." : "Added to your GIF favorites.", "success");
      }}
    >
      <Star size={16} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

function ImageEmbed({ e }: { e: UnfurlResult }) {
  const src = e.image ?? e.url;
  const dims = fit(e.image_w, e.image_h);
  const [open, setOpen] = useState(false);
  return (
    <div className={s.imageWrap} style={dims}>
      <img className={s.image} src={src} alt="" loading="lazy" style={dims} onClick={() => setOpen(true)} referrerPolicy="no-referrer" />
      {e.type === "gif" ? <span className={s.gifBadge}>GIF</span> : null}
      <FavoriteButton url={src} {...(e.image_w ? { w: e.image_w } : {})} {...(e.image_h ? { h: e.image_h } : {})} />
      {open ? (
        <div className={s.lightbox} onClick={() => setOpen(false)}>
          <img src={src} alt="" referrerPolicy="no-referrer" />
        </div>
      ) : null}
    </div>
  );
}

function YouTubeEmbed({ e }: { e: UnfurlResult }) {
  const [play, setPlay] = useState(false);
  const id = e.video_id ?? "";
  return (
    <div className={s.card}>
      {e.site_name ? <div className={s.site}>{e.site_name}</div> : <div className={s.site}>YouTube</div>}
      {e.title ? <a className={s.title} href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : null}
      {e.description ? <div className={s.desc}>{e.description}</div> : null}
      <div className={s.video}>
        {play ? (
          <iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`} title={e.title ?? "YouTube video"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button className={s.poster} onClick={() => setPlay(true)} aria-label="Play video" style={e.image ? { backgroundImage: `url(${e.image})` } : undefined}>
            <span className={s.playBtn}><Play size={26} fill="currentColor" /></span>
          </button>
        )}
      </div>
    </div>
  );
}

function LinkEmbed({ e }: { e: UnfurlResult }) {
  const big = e.image && (e.image_w ?? 0) >= 400;
  return (
    <div className={s.card} style={e.color ? { borderLeftColor: e.color } : undefined}>
      <div className={s.cardRow}>
        <div className={s.cardText}>
          {e.site_name ? <div className={s.site}>{e.site_name}</div> : null}
          {e.title ? <a className={s.title} href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : null}
          {e.description ? <div className={s.desc}>{e.description}</div> : null}
        </div>
        {e.image && !big ? <img className={s.thumb} src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
      </div>
      {e.image && big ? <img className={s.large} src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={fit(e.image_w, e.image_h, 400, 300)} /> : null}
    </div>
  );
}

export function Embeds({ list }: { list: UnfurlResult[] }) {
  const imagePreviews = useSettings((st) => st.settings.imagePreviews);
  return (
    <div className={s.embeds}>
      {list.slice(0, 5).map((e, i) => {
        if (!e || typeof e !== "object" || typeof e.url !== "string") return null;
        if (e.type === "image" || e.type === "gif") return imagePreviews ? <ImageEmbed key={i} e={e} /> : null;
        if (e.type === "video") return imagePreviews ? <video key={i} className={s.videoDirect} src={e.url} controls preload="metadata" /> : null;
        if (e.type === "youtube") return <YouTubeEmbed key={i} e={e} />;
        if (e.type === "invite") return <InviteEmbed key={i} e={e} />;
        if (e.title || e.description) return <LinkEmbed key={i} e={e} />;
        return null;
      })}
    </div>
  );
}

/** An invite to somewhere on this instance, with a way in. */
function InviteEmbed({ e }: { e: UnfurlResult }) {
  const nav = useNavigate();
  const open = () => {
    try {
      const u = new URL(e.url, window.location.origin);
      // Keep the fragment: it carries the key that unlocks the history.
      if (u.origin === window.location.origin) nav(u.pathname + u.search + u.hash);
      else window.open(e.url, "_blank", "noopener");
    } catch {
      window.open(e.url, "_blank", "noopener");
    }
  };
  const members = typeof e.member_count === "number" ? `${e.member_count} member${e.member_count === 1 ? "" : "s"}` : "";
  const online = typeof e.online_count === "number" && e.online_count > 0 ? `${e.online_count} online` : "";
  return (
    <div className={s.invite} data-testid="invite-embed">
      <div className={s.inviteHead}>You have been invited to join</div>
      <div className={s.inviteBody}>
        {e.image ? (
          <img className={s.inviteIcon} src={e.image} alt="" loading="lazy" />
        ) : (
          <span className={s.inviteIcon} data-blank="true">{(e.title ?? "?").slice(0, 1).toUpperCase()}</span>
        )}
        <div className={s.inviteText}>
          <span className={s.inviteName}>{e.title}</span>
          <span className={s.inviteSub}>{[online, members].filter(Boolean).join(" · ") || e.description}</span>
        </div>
        <Button size="sm" variant="positive" onClick={open} data-testid="invite-join">Join</Button>
      </div>
    </div>
  );
}
