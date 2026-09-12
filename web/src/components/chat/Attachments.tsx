import { Download, FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AttachmentMeta } from "@/crypto/message";
import { attachmentObjectURL, cachedURL } from "@/lib/mediaCache";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "./Chat.module.css";

const MAX_W = 550;
const MAX_H = 350;

function fit(w: number | undefined, h: number | undefined): { width: number; height: number } {
  if (!w || !h) return { width: 400, height: 300 };
  let r = Math.min(1, MAX_W / w, MAX_H / h);
  if (w * r < 100 && h * r < 100) r = Math.min(100 / w, 100 / h, MAX_W / w, MAX_H / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

/** Lazily decrypts an attachment when it scrolls into view. */
function useDecrypted(att: AttachmentMeta, eager: boolean): { url: string | null; error: boolean; load: () => void } {
  const [url, setUrl] = useState<string | null>(cachedURL(att.blob_id) ?? null);
  const [error, setError] = useState(false);
  const [wanted, setWanted] = useState(eager);
  const ref = useRef(false);
  useEffect(() => {
    if (!wanted || url || ref.current) return;
    ref.current = true;
    attachmentObjectURL(att)
      .then(setUrl)
      .catch(() => setError(true));
  }, [wanted, url, att]);
  return { url, error, load: () => setWanted(true) };
}

function useInView(ref: React.RefObject<HTMLElement | null>, onView: () => void): void {
  useEffect(() => {
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
  }, [ref, onView]);
}

export function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className={s.lightbox} onClick={onClose} role="dialog" aria-label={name}>
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
  const { url, error, load } = useDecrypted(att, att.size <= 2 * 1024 * 1024);
  const [revealed, setRevealed] = useState(!att.spoiler);
  const [open, setOpen] = useState(false);
  useInView(ref, load);
  const dims = fit(att.w, att.h);
  return (
    <>
      <div ref={ref} className={s.imgWrap} data-spoiler={!revealed} style={dims} onClick={() => (revealed ? url && setOpen(true) : setRevealed(true))}>
        {url ? <img src={url} alt={att.name} width={dims.width} height={dims.height} /> : <div className={s.imgPlaceholder}>{error ? "Could not decrypt" : "Decrypting…"}</div>}
        {!revealed ? <div className={s.spoilerTag}><span>SPOILER</span></div> : null}
      </div>
      {open && url ? <Lightbox src={url} name={att.name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VideoAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const { url, error, load } = useDecrypted(att, false);
  const [revealed, setRevealed] = useState(!att.spoiler);
  useInView(ref, load);
  const dims = fit(att.w ?? 640, att.h ?? 360);
  return (
    <div ref={ref} className={s.imgWrap} data-spoiler={!revealed} style={dims} onClick={() => !revealed && setRevealed(true)}>
      {url ? <video src={url} controls={revealed} preload="metadata" /> : <div className={s.imgPlaceholder}>{error ? "Could not decrypt" : "Decrypting…"}</div>}
      {!revealed ? <div className={s.spoilerTag}><span>SPOILER</span></div> : null}
    </div>
  );
}

function AudioAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const { url, load } = useDecrypted(att, true);
  useInView(ref, load);
  return <div ref={ref} className={s.audio}>{url ? <audio src={url} controls preload="metadata" style={{ width: "100%" }} /> : <span className={s.fileSize}>Decrypting audio…</span>}</div>;
}

function FileAttachment({ att }: { att: AttachmentMeta }) {
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await attachmentObjectURL(att);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.name;
      a.click();
    } catch {
      toast("Could not decrypt that file.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.file}>
      <FileIcon size={36} className={s.fileIcon} />
      <div className={s.fileText}>
        <span className={s.fileName} onClick={() => void download()}>{att.name}</span>
        <span className={s.fileSize}>{formatBytes(att.size)}</span>
      </div>
      <button className={s.dl} aria-label="Download" onClick={() => void download()} disabled={busy}><Download size={20} /></button>
    </div>
  );
}

export function Attachments({ list }: { list: AttachmentMeta[] }) {
  return (
    <div className={s.att}>
      {list.map((att) => {
        const t = att.type || "";
        if (t.startsWith("image/")) return <ImageAttachment key={att.blob_id} att={att} />;
        if (t.startsWith("video/")) return <VideoAttachment key={att.blob_id} att={att} />;
        if (t.startsWith("audio/")) return <AudioAttachment key={att.blob_id} att={att} />;
        return <FileAttachment key={att.blob_id} att={att} />;
      })}
    </div>
  );
}
