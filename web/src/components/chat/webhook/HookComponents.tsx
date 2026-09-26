import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { emojiUrl } from "@/api/users";
import { Twemoji } from "@/components/common/Twemoji";
import { Markdown } from "@/markdown";
import { useRowRenderCtx } from "@/lib/markdownCtx";
import { imageNameFromUrl } from "@/lib/imageActions";
import { mediaSrc } from "@/lib/mediaLinks";
import { useSettings } from "@/stores/settings";
import {
  BUTTON_LINK,
  C_ACTION_ROW,
  C_BUTTON,
  C_CONTAINER,
  C_FILE,
  C_GALLERY,
  C_SECTION,
  C_SEPARATOR,
  C_TEXT,
  C_THUMBNAIL,
  mediaAttachment,
  type HookComponent,
  type HookContent,
  type HookEmoji,
  type HookMedia,
} from "@/lib/webhookMessage";
import { Attachments } from "../Attachments";
import { Lightbox, type LightboxItem } from "../Lightbox";
import { VideoPlayer } from "../VideoPlayer";
import { useHookSrc } from "./useHookSrc";
import s from "./Webhook.module.css";

import { t } from "@/i18n";

/**
 * A webhook message's components: rows of link buttons under its content, or,
 * for a message laid out by them (v2), the whole of it: text, sections with a
 * picture or a button beside them, galleries, files, separators and boxes.
 * Only link buttons are ever sent (there is no app to answer any other), and
 * a link opens in a new tab like any link in a message.
 */
export function HookComponents({ hook, v2, from }: { hook: HookContent; v2: boolean; from: string }) {
  if (!hook.components.length) return null;
  return (
    <div className={[s.components, v2 ? s.v2 : ""].join(" ")} data-testid="webhook-components">
      {hook.components.map((c, i) => (
        <Component key={i} c={c} hook={hook} from={from} />
      ))}
    </div>
  );
}

function Component({ c, hook, from }: { c: HookComponent; hook: HookContent; from: string }) {
  const ctx = useRowRenderCtx();
  switch (c.type) {
    case C_ACTION_ROW:
      return (
        <div className={s.row}>
          {c.components.map((b, i) => (b.type === C_BUTTON ? <LinkButton key={i} b={b} /> : null))}
        </div>
      );
    case C_BUTTON:
      return <LinkButton b={c} />;
    case C_TEXT:
      return c.content ? (
        <div className={s.text} dir="auto">
          <Markdown source={c.content} ctx={ctx} />
        </div>
      ) : null;
    case C_SECTION:
      return (
        <div className={s.section}>
          <div className={s.sectionText}>
            {c.components.map((x, i) => (
              <Component key={i} c={x} hook={hook} from={from} />
            ))}
          </div>
          {c.accessory ? (
            <div className={s.accessory}>
              {c.accessory.type === C_THUMBNAIL && c.accessory.media ? <Thumbnail hook={hook} c={c.accessory} /> : c.accessory.type === C_BUTTON ? <LinkButton b={c.accessory} /> : null}
            </div>
          ) : null}
        </div>
      );
    case C_THUMBNAIL:
      return c.media ? <Thumbnail hook={hook} c={c} /> : null;
    case C_GALLERY:
      return c.items.length ? <Gallery hook={hook} c={c} /> : null;
    case C_FILE: {
      const att = c.file ? mediaAttachment(hook, c.file) : null;
      if (!att) return null;
      return <Attachments list={[c.spoiler ? { ...att, spoiler: true } : att]} from={from} />;
    }
    case C_SEPARATOR:
      return <hr className={s.separator} data-divider={c.divider !== false} data-spacing={c.spacing === 2 ? 2 : 1} />;
    case C_CONTAINER:
      return <Container c={c} hook={hook} from={from} />;
    default:
      return null;
  }
}

function Container({ c, hook, from }: { c: HookComponent; hook: HookContent; from: string }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = !!c.spoiler && !revealed;
  return (
    <div
      className={[s.container, s.spoilerBox].join(" ")}
      data-accent={c.accent_color !== undefined}
      data-hidden={hidden}
      style={c.accent_color !== undefined ? ({ "--accent": `#${c.accent_color.toString(16).padStart(6, "0")}` } as React.CSSProperties) : undefined}
    >
      {hidden ? (
        <button type="button" className={s.spoilerCover} onClick={() => setRevealed(true)} aria-label={t("render.spoilerHidden")}>
          <span className={s.spoilerLabel}>{t("composer.composer.spoiler")}</span>
        </button>
      ) : null}
      {c.components.map((x, i) => (
        <Component key={i} c={x} hook={hook} from={from} />
      ))}
    </div>
  );
}

function EmojiGlyph({ e, size = 18 }: { e: HookEmoji; size?: number }) {
  if (e.id) return <img className={s.buttonEmoji} src={emojiUrl(e.id, !!e.animated, size)} alt={e.name ? `:${e.name}:` : ""} width={size} height={size} loading="lazy" draggable={false} />;
  return e.name ? <Twemoji text={e.name} className={s.buttonEmoji} /> : null;
}

function LinkButton({ b }: { b: HookComponent }) {
  if (b.style !== BUTTON_LINK || !b.url) return null;
  const host = (() => {
    try {
      return new URL(b.url).host;
    } catch {
      return b.url;
    }
  })();
  return (
    <a
      className={s.button}
      href={b.disabled ? undefined : b.url}
      target="_blank"
      rel="noopener noreferrer"
      title={b.url}
      aria-disabled={b.disabled || undefined}
      aria-label={b.label ? t("webhook.linkButton", { label: b.label, host }) : host}
      data-testid="webhook-link-button"
    >
      {b.emoji ? <EmojiGlyph e={b.emoji} /> : null}
      {b.label ? <span className={s.buttonLabel} dir="auto">{b.label}</span> : null}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function lightboxItem(hook: HookContent, m: HookMedia): LightboxItem {
  const att = mediaAttachment(hook, m);
  if (att) return { name: att.name, type: att.type, att };
  return { name: imageNameFromUrl(m.url) || "image", src: mediaSrc(m.proxy_url) || m.proxy_url };
}

function isVideo(m: HookMedia): boolean {
  return (m.content_type ?? "").startsWith("video/");
}

function Thumbnail({ hook, c }: { hook: HookContent; c: HookComponent }) {
  const media = c.media!;
  const remoteOk = useSettings((st) => st.settings.imagePreviews);
  const src = useHookSrc(hook, remoteOk || media.blob_id ? media : undefined);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const spoiler = !!c.spoiler && !revealed;
  if (!src) return src === undefined ? <span className={[s.thumbnail, s.pending].join(" ")} aria-busy="true" /> : null;
  return (
    <span className={spoiler ? s.spoiler : undefined} style={{ position: "relative", display: "block" }}>
      <img
        className={s.thumbnail}
        src={src}
        alt={c.description ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        role="button"
        tabIndex={0}
        aria-label={spoiler ? t("render.spoilerHidden") : c.description || t("webhook.openImage")}
        data-image-src={src}
        data-image-name={imageNameFromUrl(media.url) || "image"}
        onClick={() => (spoiler ? setRevealed(true) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (spoiler) setRevealed(true);
          else setOpen(true);
        }}
      />
      {spoiler ? <span className={s.spoilerLabel}>{t("composer.composer.spoiler")}</span> : null}
      {open ? <Lightbox items={[lightboxItem(hook, media)]} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function Gallery({ hook, c: all }: { hook: HookContent; c: HookComponent }) {
  const remoteOk = useSettings((st) => st.settings.imagePreviews);
  // pictures from elsewhere follow the setting for pictures from links
  const c = useMemo(() => (remoteOk ? all : { ...all, items: all.items.filter((it) => it.media.blob_id) }), [all, remoteOk]);
  const [open, setOpen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  // the viewer steps through the pictures; a spoiler not yet shown stays out of it
  const pictures = useMemo(() => c.items.map((it, i) => ({ it, i })).filter(({ it, i }) => !isVideo(it.media) && (!it.spoiler || revealed[i])), [c.items, revealed]);
  const items = useMemo(() => pictures.map(({ it }) => lightboxItem(hook, it.media)), [pictures, hook]);
  const count = c.items.length;
  if (!count) return null;
  return (
    <div className={s.mediaGrid} data-count={Math.min(count, 4)} data-many={count > 4 || undefined} data-testid="webhook-gallery">
      {c.items.map((it, i) => {
        const spoiler = !!it.spoiler && !revealed[i];
        return (
          <GalleryCell
            key={i}
            hook={hook}
            media={it.media}
            alt={it.description ?? ""}
            spoiler={spoiler}
            onOpen={() => {
              if (spoiler) setRevealed((r) => ({ ...r, [i]: true }));
              else setOpen(pictures.findIndex((p) => p.i === i));
            }}
          />
        );
      })}
      {open !== null && open >= 0 && items.length ? <Lightbox items={items} start={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function GalleryCell({ hook, media, alt, spoiler, onOpen }: { hook: HookContent; media: HookMedia; alt: string; spoiler: boolean; onOpen: () => void }) {
  const src = useHookSrc(hook, media);
  if (src === null) return null;
  if (isVideo(media) && src && !spoiler) {
    return (
      <div className={s.mediaCell} style={{ cursor: "default" }}>
        <VideoPlayer src={src} name={imageNameFromUrl(media.url) || "video"} width={media.width} height={media.height} />
      </div>
    );
  }
  return (
    <button type="button" className={[s.mediaCell, spoiler ? s.spoiler : ""].join(" ")} onClick={onOpen} aria-label={spoiler ? t("render.spoilerHidden") : alt || t("webhook.openImage")}>
      {src ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" draggable={false} data-image-src={src} data-image-name={imageNameFromUrl(media.url) || "image"} /> : null}
      {spoiler ? <span className={s.spoilerLabel}>{t("composer.composer.spoiler")}</span> : null}
    </button>
  );
}
