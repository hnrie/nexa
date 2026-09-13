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
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.stopPropagation();
        const now = toggleFavoriteGif({ url, ...(w ? { w } : {}), ...(h ? { h } : {}) });
        toast(now ? "Added to your GIF favorites." : "Removed from favorites.", "success");
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
      {e.image && big ? <img className={s.large} src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={fitCard(e.image_w, e.image_h, 400, 300)} /> : null}
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
