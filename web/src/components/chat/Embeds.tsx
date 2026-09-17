import { Play, Star } from "lucide-react";
import { useState } from "react";
import type { UnfurlResult } from "@/api/types";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { toggleFavoriteGif } from "@/lib/gifFavorites";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { Lightbox, fitMedia } from "./Attachments";
import { VideoPlayer } from "./VideoPlayer";
import c from "./Chat.module.css";
import s from "./Embeds.module.css";
import { imageNameFromUrl } from "@/lib/imageActions";

import { t } from "@/i18n";
/** A readable name for a linked file: the last part of its address. */
function fileNameOf(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}

function fitCard(w: number | undefined, h: number | undefined, maxW = 400, maxH = 300): { width: number; height: number } | undefined {
  if (!w || !h) return undefined;
  const r = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

/** Saves the proxied URL, so favourites load through this server too. */
export function FavoriteButton({ url, w, h }: { url: string; w?: number; h?: number }) {
  const on = useSettings((st) => st.settings.favoriteGifs.some((f) => f.url === url));
  const toast = useUI((u) => u.toast);
  return (
    <button
      className={s.star}
      data-on={on}
      title={on ? t("chat.embeds.removeFromFavorites") : t("chat.embeds.addToFavorites")}
      aria-label={on ? t("chat.embeds.removeFromFavorites") : t("chat.embeds.addToFavorites")}
      onClick={(e) => {
        e.stopPropagation();
        const now = toggleFavoriteGif({ url, ...(w ? { w } : {}), ...(h ? { h } : {}) });
        toast(now ? t("chat.embeds.addedToYourGifFavorites") : t("chat.embeds.removedFromFavorites"), "success");
      }}
    >
      <Star size={16} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** A linked picture or GIF, framed and opened exactly as an uploaded one is. */
function ImageEmbed({ e }: { e: UnfurlResult }) {
  const src = e.image ?? e.url;
  const [open, setOpen] = useState(false);
  // without a recorded size, the picture's own tells the frame what shape to be
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dims = fitMedia(e.image_w ?? natural?.w, e.image_h ?? natural?.h);
  const name = e.type === "gif" ? "GIF" : fileNameOf(e.url, "Image");
  // what "Download" saves it as; a GIF from the picker arrives through the proxy, whose address says nothing
  const fileName = e.type === "gif" ? "animation.gif" : fileNameOf(e.url, "image");
  return (
    <>
      <div className={[c.imgWrap, s.media].join(" ")} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }} onClick={() => setOpen(true)}>
        <img
          src={src}
          alt={name}
          width={dims.width}
          height={dims.height}
          loading="lazy"
          referrerPolicy="no-referrer"
          data-image-src={src}
          data-image-name={fileName}
          onLoad={(ev) => {
            if (!e.image_w || !e.image_h) setNatural({ w: ev.currentTarget.naturalWidth, h: ev.currentTarget.naturalHeight });
          }}
        />
        {e.type === "gif" ? <span className={s.gifBadge}>GIF</span> : null}
        <FavoriteButton url={src} {...(e.image_w ? { w: e.image_w } : {})} {...(e.image_h ? { h: e.image_h } : {})} />
      </div>
      {open ? <Lightbox src={src} name={fileName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The sites whose players a card may open in a frame. The server builds the
 * address (internal/unfurl/players.go); this list is the second lock, so a
 * preview that ever came from somewhere else still cannot run a page here.
 */
const PLAYER_HOSTS = new Set(["www.youtube-nocookie.com", "player.vimeo.com", "player.twitch.tv", "clips.twitch.tv", "www.dailymotion.com", "streamable.com", "www.loom.com"]);

function playerSrc(e: UnfurlResult): string | null {
  const raw = e.player ?? (e.video_id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(e.video_id)}?autoplay=1&rel=0` : null);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PLAYER_HOSTS.has(u.host) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "3 Feb 2026", for the line under a card's title. */
function publishedOn(ms: number | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The line above the title: the site's icon, its name, the author, the date. */
function CardHead({ e }: { e: UnfurlResult }) {
  const when = publishedOn(e.published_at);
  const author = e.author_url ? (
    <a href={e.author_url} target="_blank" rel="noopener noreferrer">{e.author || e.author_url.replace(/^https?:\/\//, "")}</a>
  ) : e.author ? (
    <span>{e.author}</span>
  ) : null;
  if (!e.site_name && !author && !when && !e.icon) return null;
  return (
    <div className={s.site}>
      {e.icon ? <img className={s.favicon} src={e.icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(ev) => (ev.currentTarget.style.display = "none")} /> : null}
      {e.site_name ? <span>{e.site_name}</span> : null}
      {author ? <><span className={s.dot} aria-hidden="true">·</span>{author}</> : null}
      {when ? <><span className={s.dot} aria-hidden="true">·</span><time dateTime={new Date(e.published_at!).toISOString()}>{when}</time></> : null}
    </div>
  );
}

/**
 * One link's card. Everything on it is drawn from fields the server filled in
 * — no markup from the page itself ever reaches the document. The single
 * exception is a video, which needs its site's own player; that frame only
 * opens for the handful of sites both ends agree on, and only when asked.
 */
function LinkEmbed({ e }: { e: UnfurlResult }) {
  const [play, setPlay] = useState(false);
  const src = playerSrc(e);
  const big = e.image && (e.image_w ?? 0) >= 400;
  const title = e.title ? <a className={s.title} href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : null;
  if (src) {
    return (
      <div className={s.card} style={e.color ? { borderLeftColor: e.color } : undefined}>
        <CardHead e={e} />
        {title}
        {e.description ? <div className={s.desc}>{e.description}</div> : null}
        <div className={s.video}>
          {play ? (
            <iframe
              src={src}
              title={e.title ?? "Video"}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <button className={s.poster} onClick={() => setPlay(true)} aria-label={t("chat.embeds.playVideo")} style={e.image ? { backgroundImage: `url(${e.image})` } : undefined}>
              <span className={s.playBtn}><Play size={26} fill="currentColor" /></span>
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={s.card} style={e.color ? { borderLeftColor: e.color } : undefined}>
      <div className={s.cardRow}>
        <div className={s.cardText}>
          <CardHead e={e} />
          {title}
          {e.description ? <div className={s.desc}>{e.description}</div> : null}
        </div>
        {e.image && !big && !e.media ? <img className={s.thumb} src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" data-image-src={e.image} data-image-name={imageNameFromUrl(e.image)} /> : null}
      </div>
      {/* a file this browser plays on its own; the page it came from runs nothing */}
      {e.media && e.media_kind === "video" ? (
        <VideoPlayer src={e.media} name={fileNameOf(e.url, "Video")} width={e.media_w} height={e.media_h} />
      ) : e.media && e.media_kind === "audio" ? (
        <audio className={s.audio} src={e.media} controls preload="none" />
      ) : e.image && big ? (
        <img className={s.large} src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={fitCard(e.image_w, e.image_h, 400, 300)} data-image-src={e.image} data-image-name={imageNameFromUrl(e.image)} />
      ) : null}
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
        // played through this server's proxy, so the host of the file never sees who is watching
        if (e.type === "video") return imagePreviews ? <VideoPlayer key={i} src={e.image ?? e.url} name={fileNameOf(e.url, "Video")} width={e.image_w} height={e.image_h} /> : null;
        if (e.type === "youtube") return <LinkEmbed key={i} e={e} />;
        if (e.type === "invite") return <InviteEmbed key={i} e={e} />;
        if (e.title || e.description || e.player || e.media) return <LinkEmbed key={i} e={e} />;
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
      <div className={s.inviteHead}>{t("chat.embeds.youHaveBeenInvitedToJoin")}</div>
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
        <Button size="sm" variant="positive" onClick={open} data-testid="invite-join">{t("chat.embeds.join")}</Button>
      </div>
    </div>
  );
}
