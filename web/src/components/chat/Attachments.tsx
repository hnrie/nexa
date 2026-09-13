import { Download, FileIcon, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AttachmentMeta } from "@/crypto/message";
import { saveAttachment } from "@/lib/download";
import { INLINE_MAX, attachmentObjectURL, cachedURL } from "@/lib/mediaCache";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { Spinner } from "@/components/common/Spinner";
import { AudioPlayer } from "./AudioPlayer";
import { VideoPlayer } from "./VideoPlayer";
import s from "./Chat.module.css";

const MAX_W = 550;
const MAX_H = 350;

/** Small pictures are fetched straight away, before they are even on screen. */
const EAGER_MAX = 2 * 1024 * 1024;
/**
 * Media up to this size loads by itself: video and audio straight away,
 * pictures as they near the screen. Anything bigger waits to be asked for,
 * since every copy of the app showing the message would otherwise download
 * and decrypt all of it.
 */
const AUTO_LOAD_MAX = 25 * 1024 * 1024;

function fit(w: number | undefined, h: number | undefined): { width: number; height: number } {
  if (!w || !h) return { width: 400, height: 300 };
  let r = Math.min(1, MAX_W / w, MAX_H / h);
  if (w * r < 100 && h * r < 100) r = Math.min(100 / w, 100 / h, MAX_W / w, MAX_H / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

/** Decrypts an attachment once it is wanted: straight away when `eager`, otherwise when `load` is called. */
function useDecrypted(att: AttachmentMeta, eager: boolean): { url: string | null; error: boolean; wanted: boolean; load: () => void } {
  const [url, setUrl] = useState<string | null>(cachedURL(att.blob_id) ?? null);
  const [error, setError] = useState(false);
  const [wanted, setWanted] = useState(eager);
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || url || started.current) return;
    started.current = true;
    attachmentObjectURL(att)
      .then(setUrl)
      .catch(() => setError(true));
  }, [wanted, url, att]);
  const load = useCallback(() => setWanted(true), []);
  return { url, error, wanted, load };
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

export function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.lightbox} onClick={onClose} role="dialog" aria-label={name}>
      <button className={s.lbClose} aria-label="Close" onClick={onClose}><X size={22} /></button>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <div className={s.lbBar} onClick={(e) => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noopener noreferrer">Open original</a>
        <a href={src} download={name}>Download</a>
      </div>
    </div>,
    document.body,
  );
}

function ImageAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load } = useDecrypted(att, att.size <= EAGER_MAX);
  const [revealed, setRevealed] = useState(!att.spoiler);
  const [open, setOpen] = useState(false);
  useInView(ref, load, auto);
  const dims = fit(att.w, att.h);
  return (
    <>
      <div ref={ref} className={s.imgWrap} data-spoiler={!revealed} style={dims} onClick={() => (revealed ? url && setOpen(true) : setRevealed(true))}>
        {url ? (
          <img src={url} alt={att.name} width={dims.width} height={dims.height} />
        ) : (
          <div className={s.imgPlaceholder}>
            {error ? (
              "Could not decrypt"
            ) : wanted || auto ? (
              "Decrypting…"
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
                Load image ({formatBytes(att.size)})
              </button>
            )}
          </div>
        )}
        {!revealed ? <div className={s.spoilerTag}><span>SPOILER</span></div> : null}
      </div>
      {open && url ? <Lightbox src={url} name={att.name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VideoAttachment({ att }: { att: AttachmentMeta }) {
  // the whole file has to come down and be decrypted before it can play at all
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load } = useDecrypted(att, auto);
  const dims = fit(att.w ?? 640, att.h ?? 360);
  if (url) return <VideoPlayer src={url} name={att.name} width={att.w} height={att.h} spoiler={att.spoiler ?? false} />;
  return (
    <div className={s.videoPending} style={dims}>
      {error ? (
        <span>This video could not be decrypted.</span>
      ) : wanted || auto ? (
        <span className={s.videoLoading}><Spinner size={20} /> Decrypting {att.name} ({formatBytes(att.size)})…</span>
      ) : (
        <button className={s.videoLoad} onClick={load}>
          <Play size={20} /> Load video ({formatBytes(att.size)})
        </button>
      )}
    </div>
  );
}

function AudioAttachment({ att }: { att: AttachmentMeta }) {
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load } = useDecrypted(att, auto);
  return (
    <div className={s.audio}>
      {url ? (
        <AudioPlayer src={url} name={att.name} size={att.size} duration={att.duration} />
      ) : error ? (
        <span className={s.fileSize}>This audio could not be decrypted.</span>
      ) : wanted || auto ? (
        <span className={s.fileSize}>Decrypting {att.name}…</span>
      ) : (
        <button className={s.videoLoad} onClick={load}>
          <Play size={16} /> Load {att.name} ({formatBytes(att.size)})
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
      toast(err instanceof Error && err.message ? err.message : "Could not download that file.", "error");
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
        <span className={s.fileSize}>{busy ? `Downloading… ${percent}% of ${formatBytes(att.size)}` : formatBytes(att.size)}</span>
      </div>
      <button className={s.dl} aria-label="Download" onClick={() => void download()} disabled={busy}>{busy ? <Spinner size={20} /> : <Download size={20} />}</button>
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
