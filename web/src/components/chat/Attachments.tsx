import { Download, FileIcon, Play, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DecryptError } from "@/crypto/keys";
import type { AttachmentMeta } from "@/crypto/message";
import { saveAttachment } from "@/lib/download";
import { INLINE_MAX, acquire, attachmentObjectURL, cachedURL, release } from "@/lib/mediaCache";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { Spinner } from "@/components/common/Spinner";
import { ZoomPan, type ZoomPanHandle } from "@/components/common/ZoomPan";
import { AudioPlayer } from "./AudioPlayer";
import { imageMenuItems } from "./messageMenu";
import { FavoriteButton } from "./FavoriteButton";
import { VideoPlayer } from "./VideoPlayer";
import { fitMedia, fitVideo } from "./fitMedia";
import s from "./Chat.module.css";

import { t as tr_ } from "@/i18n";
export { fitMedia };

/** Small pictures are fetched straight away, before they are even on screen. */
const EAGER_MAX = 2 * 1024 * 1024;
/**
 * Media up to this size loads by itself: video and audio straight away,
 * pictures as they near the screen. Anything bigger waits to be asked for,
 * since every copy of the app showing the message would otherwise download
 * and decrypt all of it.
 */
const AUTO_LOAD_MAX = 25 * 1024 * 1024;

type LoadError = "load" | "decrypt";

/** Decrypts an attachment once it is wanted: straight away when `eager`, otherwise when `load` is called. */
function useDecrypted(att: AttachmentMeta, eager: boolean): { url: string | null; error: LoadError | null; wanted: boolean; load: () => void; retry: () => void } {
  const [url, setUrl] = useState<string | null>(cachedURL(att.blob_id) ?? null);
  const [error, setError] = useState<LoadError | null>(null);
  const [wanted, setWanted] = useState(eager);
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || url || error || started.current) return;
    started.current = true;
    attachmentObjectURL(att)
      .then(setUrl)
      .catch((err: unknown) => {
        // a dropped connection is worth another try, which clearing the error starts
        started.current = false;
        setError(err instanceof DecryptError ? "decrypt" : "load");
      });
  }, [wanted, url, error, att]);
  // Hold the URL while this is on screen, so the cache does not revoke it
  // under a download link or a video that is still reading from it.
  useEffect(() => {
    if (!url) return;
    if (!acquire(att.blob_id, url)) {
      started.current = false;
      setUrl(null);
      return;
    }
    return () => release(att.blob_id, url);
  }, [url, att.blob_id]);
  const load = useCallback(() => setWanted(true), []);
  const retry = useCallback(() => setError(null), []);
  return { url, error, wanted, load, retry };
}

/** Why an attachment is not showing, with a way to try again when that could help. */
/** What failed, said per kind: a word slotted into one sentence reads wrong in most languages. */
const FAILED = {
  image: ["chat.attachments.imageUndecryptable", "chat.attachments.imageUnloadable"],
  video: ["chat.attachments.videoUndecryptable", "chat.attachments.videoUnloadable"],
  audio: ["chat.attachments.audioUndecryptable", "chat.attachments.audioUnloadable"],
} as const;

function LoadFailed({ error, what, onRetry }: { error: LoadError; what: keyof typeof FAILED; onRetry: () => void }) {
  return (
    <span className={s.loadFailed}>
      {tr_(FAILED[what][error === "decrypt" ? 0 : 1])}
      {error === "load" ? (
        <button
          className={s.retry}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          {tr_("chat.messageItem.retry")}
        </button>
      ) : null}
    </span>
  );
}

function useInView(ref: React.RefObject<HTMLElement | null>, onView: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      onView();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        onView();
        io.disconnect();
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, onView, enabled]);
}

export function Lightbox({ src, name, type, onClose }: { src: string; name: string; type?: string | undefined; onClose: () => void }) {
  const openContextMenu = useUI((u) => u.openContextMenu);
  const [scale, setScale] = useState(1);
  const zoom = useRef<ZoomPanHandle>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") return zoom.current?.zoomBy(1.4);
      if (e.key === "-") return zoom.current?.zoomBy(1 / 1.4);
      if (e.key !== "Escape") return;
      // the lightbox takes this Escape; it does not also stop picking messages
      // under it, nor close the panels beside the chat (they look for this)
      e.stopPropagation();
      e.preventDefault();
      // zoomed in, Escape steps back to the whole picture before it closes
      if (zoomedIn.current) zoom.current?.reset();
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const zoomedIn = useRef(false);
  zoomedIn.current = scale > 1;
  return createPortal(
    // a layer, so the back gesture on a phone puts the picture away rather than leaving the page under it
    <div className={s.lightbox} onClick={onClose} role="dialog" aria-label={name} data-zoomed={scale > 1 || undefined} data-modal-layer="">
      <button className={s.lbClose} aria-label={tr_("chat.attachments.close")} onClick={onClose}><X size={22} /></button>
      <ZoomPan className={s.lbStage} handle={zoom} onZoom={setScale} onIdleClick={onClose}>
        <img
          src={src}
          alt={name}
          draggable={false}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openContextMenu({ x: e.clientX, y: e.clientY, items: imageMenuItems({ src, name }) });
          }}
        />
      </ZoomPan>
      <div className={s.lbBar} onClick={(e) => e.stopPropagation()}>
        <button aria-label={tr_("chat.attachments.zoomOut")} onClick={() => zoom.current?.zoomBy(1 / 1.4)}><ZoomOut size={16} /></button>
        <button onClick={() => zoom.current?.reset()} disabled={scale === 1} data-testid="lightbox-zoom">{Math.round(scale * 100)}%</button>
        <button aria-label={tr_("chat.attachments.zoomIn")} onClick={() => zoom.current?.zoomBy(1.4)}><ZoomIn size={16} /></button>
        {/* an SVG opened on its own is a page in this app's origin that can reach out to other servers */}
        {type?.toLowerCase().startsWith("image/svg") ? null : <a href={src} target="_blank" rel="noopener noreferrer">{tr_("chat.attachments.openOriginal")}</a>}
        <a href={src} download={name}>{tr_("chat.attachments.download")}</a>
      </div>
    </div>,
    document.body,
  );
}

function ImageAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load, retry } = useDecrypted(att, att.size <= EAGER_MAX);
  const [revealed, setRevealed] = useState(!att.spoiler);
  const [open, setOpen] = useState(false);
  useInView(ref, load, auto);
  const dims = fitMedia(att.w, att.h);
  return (
    <>
      <div ref={ref} className={s.imgWrap} data-spoiler={!revealed} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }} onClick={() => (revealed ? url && setOpen(true) : setRevealed(true))}>
        {att.type === "image/gif" ? <FavoriteButton url={`attach:${att.blob_id}`} w={att.w} h={att.h} att={att} className={s.favStar} /> : null}
        {url ? (
          <img src={url} alt={att.name} width={dims.width} height={dims.height} data-image-src={url} data-image-name={att.name} />
        ) : (
          <div className={s.imgPlaceholder}>
            {error ? (
              <LoadFailed error={error} what="image" onRetry={retry} />
            ) : wanted || auto ? (
              tr_("chat.attachments.decryptingShort")
            ) : (
              <button
                className={s.videoLoad}
                onClick={(e) => {
                  // under a spoiler, the first click only uncovers it
                  if (!revealed) return;
                  e.stopPropagation();
                  load();
                }}
              >
                {tr_("chat.attachments.loadImage", { size: formatBytes(att.size) })}
              </button>
            )}
          </div>
        )}
        {!revealed ? <div className={s.spoilerTag}><span>{tr_("composer.composer.spoiler")}</span></div> : null}
      </div>
      {open && url ? <Lightbox src={url} name={att.name} type={att.type} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VideoAttachment({ att }: { att: AttachmentMeta }) {
  // the whole file has to come down and be decrypted before it can play at all
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  // Waiting for the row to near the screen, as pictures do. Starting on mount
  // downloaded and decrypted every clip in the loaded history at once, each of
  // them held in memory from that moment on.
  const { url, error, wanted, load, retry } = useDecrypted(att, false);
  useInView(ref, load, auto);
  // the same frame the player will have, so nothing jumps when it arrives
  const dims = fitVideo(att.w ?? 640, att.h ?? 360);
  if (url) return <VideoPlayer src={url} name={att.name} width={att.w} height={att.h} spoiler={att.spoiler ?? false} />;
  return (
    <div ref={ref} className={s.videoPending} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }}>
      {error ? (
        <LoadFailed error={error} what="video" onRetry={retry} />
      ) : wanted || auto ? (
        <span className={s.videoLoading}><Spinner size={20} /> {tr_("chat.attachments.decryptingNamed", { name: att.name, size: formatBytes(att.size) })}</span>
      ) : (
        <button className={s.videoLoad} onClick={load}>
          <Play size={20} /> {tr_("chat.attachments.loadVideo", { size: formatBytes(att.size) })}
        </button>
      )}
    </div>
  );
}

function AudioAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load, retry } = useDecrypted(att, false);
  useInView(ref, load, auto);
  return (
    <div ref={ref} className={s.audio}>
      {url ? (
        <AudioPlayer src={url} name={att.name} size={att.size} duration={att.duration} />
      ) : error ? (
        <span className={s.fileSize}><LoadFailed error={error} what="audio" onRetry={retry} /></span>
      ) : wanted || auto ? (
        <span className={s.fileSize}>{tr_("chat.attachments.decrypting", { name: att.name })}</span>
      ) : (
        <button className={s.videoLoad} onClick={load}>
          <Play size={16} /> {tr_("chat.attachments.loadNamed", { name: att.name, size: formatBytes(att.size) })}
        </button>
      )}
    </div>
  );
}

function FileAttachment({ att }: { att: AttachmentMeta }) {
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setDone(0);
    try {
      await saveAttachment(att, (n) => setDone(n));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : tr_("chat.attachments.couldNotDownloadThatFile"), "error");
    } finally {
      setBusy(false);
    }
  };
  const percent = att.size > 0 ? Math.min(100, Math.floor((done / att.size) * 100)) : 0;
  return (
    <div className={s.file}>
      <FileIcon size={36} className={s.fileIcon} />
      <div className={s.fileText}>
        <span className={s.fileName} onClick={() => void download()}>{att.name}</span>
        <span className={s.fileSize}>{busy ? tr_("chat.attachments.downloadingPercent", { percent, size: formatBytes(att.size) }) : formatBytes(att.size)}</span>
      </div>
      <button className={s.dl} aria-label={tr_("chat.attachments.download")} onClick={() => void download()} disabled={busy}>{busy ? <Spinner size={20} /> : <Download size={20} />}</button>
    </div>
  );
}

export function Attachments({ list }: { list: AttachmentMeta[] }) {
  return (
    <div className={s.att}>
      {list.map((att) => {
        const t = att.type || "";
        // showing or playing a file means holding all of it, so past a point it is only offered as a download
        const inline = att.size <= INLINE_MAX;
        if (inline && t.startsWith("image/")) return <ImageAttachment key={att.blob_id} att={att} />;
        if (inline && t.startsWith("video/")) return <VideoAttachment key={att.blob_id} att={att} />;
        if (inline && t.startsWith("audio/")) return <AudioAttachment key={att.blob_id} att={att} />;
        return <FileAttachment key={att.blob_id} att={att} />;
      })}
    </div>
  );
}
