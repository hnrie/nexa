import { useMemo, useState } from "react";
import { Markdown } from "@/markdown";
import { useRowRenderCtx } from "@/lib/markdownCtx";
import { formatFull, formatTimestamp } from "@/lib/time";
import { imageNameFromUrl } from "@/lib/imageActions";
import { mediaSrc } from "@/lib/mediaLinks";
import { useSettings } from "@/stores/settings";
import { mediaAttachment, type HookContent, type HookEmbed, type HookEmbedField, type HookMedia } from "@/lib/webhookMessage";
import { Lightbox, type LightboxItem } from "../Lightbox";
import { useHookIcon, useHookSrc } from "./useHookSrc";
import s from "./Webhook.module.css";

import { t } from "@/i18n";

/** How many pictures of embeds that share a link are shown together in the first of them. */
const GALLERY_MAX = 4;

interface Shown {
  embed: HookEmbed;
  images: HookMedia[];
}

/**
 * Embeds that share a link show as one: the first, with the others' pictures
 * added to its own in a grid, as Discord shows them. That is how a webhook
 * posts several pictures in one card.
 */
export function mergeGalleries(embeds: HookEmbed[]): Shown[] {
  const out: Shown[] = [];
  const byUrl = new Map<string, Shown>();
  for (const e of embeds) {
    const first = e.url ? byUrl.get(e.url) : undefined;
    if (first) {
      if (e.image && first.images.length < GALLERY_MAX) first.images.push(e.image);
      continue;
    }
    const shown: Shown = { embed: e, images: e.image ? [e.image] : [] };
    if (e.url) byUrl.set(e.url, shown);
    out.push(shown);
  }
  return out;
}

/**
 * Rows of fields: an inline field shares a row with the inline ones around it,
 * three to a row (two beside a thumbnail); any other takes a row of its own.
 * Each is placed on a grid of twelve columns.
 */
export function fieldRows(fields: HookEmbedField[], thumbnail: boolean): { field: HookEmbedField; column: string }[] {
  const per = thumbnail ? 2 : 3;
  const out: { field: HookEmbedField; column: string }[] = [];
  let run: HookEmbedField[] = [];
  const flush = () => {
    const span = 12 / run.length;
    run.forEach((field, i) => out.push({ field, column: `${1 + i * span} / ${1 + (i + 1) * span}` }));
    run = [];
  };
  for (const f of fields) {
    if (!f.inline) {
      if (run.length) flush();
      out.push({ field: f, column: "1 / 13" });
      continue;
    }
    run.push(f);
    if (run.length === per) flush();
  }
  if (run.length) flush();
  return out;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function RichEmbeds({ hook }: { hook: HookContent }) {
  const shown = useMemo(() => mergeGalleries(hook.embeds), [hook.embeds]);
  if (!shown.length) return null;
  return (
    <div className={s.embeds}>
      {shown.map((x, i) => (x.embed.type === "poll_result" ? null : <RichEmbed key={i} hook={hook} embed={x.embed} images={x.images} />))}
    </div>
  );
}

function RichEmbed({ hook, embed, images: all }: { hook: HookContent; embed: HookEmbed; images: HookMedia[] }) {
  const ctx = useRowRenderCtx();
  const [open, setOpen] = useState<number | null>(null);
  // pictures from elsewhere follow the setting for pictures from links; the
  // message's own files always show, as attachments do
  const remoteOk = useSettings((st) => st.settings.imagePreviews);
  const images = useMemo(() => (remoteOk ? all : all.filter((m) => m.blob_id)), [all, remoteOk]);
  const thumbnail = embed.thumbnail && (remoteOk || embed.thumbnail.blob_id) ? embed.thumbnail : undefined;
  const thumb = !!thumbnail;
  const rows = useMemo(() => fieldRows(embed.fields, thumb), [embed.fields, thumb]);
  const lightbox = useMemo<LightboxItem[]>(
    () => [...images, ...(thumbnail ? [thumbnail] : [])].map((m) => lightboxItem(hook, m)),
    [hook, images, thumbnail],
  );
  const title = embed.title ? <Markdown source={embed.title} ctx={ctx} inline /> : null;
  return (
    <article className={s.embed} style={embed.color !== undefined ? { borderInlineStartColor: hex(embed.color) } : undefined} data-testid="rich-embed">
      <div className={s.grid} data-thumb={thumb}>
        {embed.author ? <EmbedAuthor hook={hook} embed={embed} /> : null}
        {title ? (
          embed.url ? (
            <a className={s.title} href={embed.url} target="_blank" rel="noopener noreferrer" dir="auto">{title}</a>
          ) : (
            <div className={s.title} dir="auto">{title}</div>
          )
        ) : null}
        {embed.description ? (
          <div className={s.description} dir="auto">
            <Markdown source={embed.description} ctx={ctx} />
          </div>
        ) : null}
        {rows.length ? (
          <div className={s.fields}>
            {rows.map(({ field, column }, i) => (
              <div key={i} className={s.field} style={{ gridColumn: column }}>
                <div className={s.fieldName} dir="auto"><Markdown source={field.name} ctx={ctx} inline /></div>
                <div className={s.fieldValue} dir="auto"><Markdown source={field.value} ctx={ctx} /></div>
              </div>
            ))}
          </div>
        ) : null}
        {images.length === 1 ? (
          <EmbedImage hook={hook} media={images[0]!} kind="image" onOpen={() => setOpen(0)} />
        ) : images.length > 1 ? (
          <div className={s.gallery} data-count={images.length}>
            {images.map((m, i) => (
              <button key={i} type="button" onClick={() => setOpen(i)} aria-label={m.description || t("webhook.openImage")}>
                <EmbedPicture hook={hook} media={m} />
              </button>
            ))}
          </div>
        ) : null}
        {thumbnail ? <EmbedImage hook={hook} media={thumbnail} kind="thumb" onOpen={() => setOpen(images.length)} /> : null}
        {embed.footer || embed.timestamp ? <EmbedFooter hook={hook} embed={embed} /> : null}
      </div>
      {open !== null && lightbox.length ? <Lightbox items={lightbox} start={open} onClose={() => setOpen(null)} /> : null}
    </article>
  );
}

function lightboxItem(hook: HookContent, m: HookMedia): LightboxItem {
  const att = mediaAttachment(hook, m);
  if (att) return { name: att.name, type: att.type, att };
  // the address as signed just now, when the one in the message has run out
  return { name: imageNameFromUrl(m.url) || "image", src: mediaSrc(m.proxy_url) || m.proxy_url };
}

function EmbedAuthor({ hook, embed }: { hook: HookContent; embed: HookEmbed }) {
  const a = embed.author!;
  const icon = useHookIcon(hook, a.proxy_icon_url, a.icon_blob_id);
  return (
    <div className={s.author} dir="auto">
      {icon ? <img className={s.authorIcon} src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} /> : null}
      {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> : <span>{a.name}</span>}
    </div>
  );
}

function EmbedFooter({ hook, embed }: { hook: HookContent; embed: HookEmbed }) {
  const f = embed.footer;
  const icon = useHookIcon(hook, f?.proxy_icon_url, f?.icon_blob_id);
  return (
    <div className={s.footer}>
      {icon ? <img className={s.footerIcon} src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} /> : null}
      <span className={s.footerText} dir="auto">
        {f?.text}
        {f?.text && embed.timestamp ? <span className={s.sep} aria-hidden="true"> • </span> : null}
        {embed.timestamp ? <time dateTime={new Date(embed.timestamp).toISOString()} title={formatFull(embed.timestamp)}>{formatTimestamp(embed.timestamp)}</time> : null}
      </span>
    </div>
  );
}

/** A picture in an embed, framed at its own shape once it is known. */
function EmbedPicture({ hook, media }: { hook: HookContent; media: HookMedia }) {
  const src = useHookSrc(hook, media);
  if (src === null) return null;
  if (src === undefined) return <span className={s.pending} style={{ display: "block", width: "100%", height: "100%", minHeight: 80 }} aria-busy="true" />;
  return <img src={src} alt={media.description ?? ""} loading="lazy" referrerPolicy="no-referrer" draggable={false} data-image-src={src} data-image-name={imageNameFromUrl(media.url) || "image"} />;
}

function EmbedImage({ hook, media, kind, onOpen }: { hook: HookContent; media: HookMedia; kind: "image" | "thumb"; onOpen: () => void }) {
  const src = useHookSrc(hook, media);
  const [broken, setBroken] = useState(false);
  const className = kind === "thumb" ? s.thumb : s.image;
  if (src === null || broken) return null;
  const box = media.width && media.height ? fit(media.width, media.height, kind === "thumb" ? 80 : 400, kind === "thumb" ? 80 : 300) : undefined;
  if (src === undefined) return <div className={[className, s.pending].join(" ")} style={box ?? { width: 80, height: 80 }} aria-busy="true" />;
  return (
    <div className={className}>
      <img
        src={src}
        alt={media.description ?? ""}
        width={box?.width}
        height={box?.height}
        loading="lazy"
        referrerPolicy="no-referrer"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={media.description || t("webhook.openImage")}
        data-image-src={src}
        data-image-name={imageNameFromUrl(media.url) || "image"}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onOpen();
        }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

function fit(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const r = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}
