import { AlertCircle, FileIcon, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AttachmentMeta } from "@/crypto/message";
import { Attachments } from "@/components/chat/Attachments";
import { acquire, attachmentObjectURL, cachedURL, PRIORITY, release } from "@/lib/mediaCache";
import { copyOf } from "@/lib/pictureCopy";
import { FILE_MIN_WIDTH } from "@/markdown/parse";
import { t } from "@/i18n";
import s from "./Notes.module.css";

/** A file on its way into a note from this device. */
export interface PendingUpload {
  name: string;
  /** From 0 to 1. */
  progress: number;
  /** Why it did not go up, when it did not. */
  error: string | null;
}

interface Props {
  meta: AttachmentMeta | undefined;
  /** What the note's text calls it. */
  name: string;
  pending?: PendingUpload | undefined;
  /** In a note being written: takes the file out of it. */
  onRemove?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** How much of the line a picture or video takes, in percent. */
  width?: number | undefined;
  /** In a note being written: makes a picture or video that wide. */
  onResize?: ((width: number) => void) | undefined;
}

/** The sizes offered at a click, in percent of the line. */
const SIZES: { width: number; label: () => string }[] = [
  { width: 33, label: () => t("notes.file.small") },
  { width: 50, label: () => t("notes.file.medium") },
  { width: 75, label: () => t("notes.file.large") },
  { width: 100, label: () => t("notes.file.fullWidth") },
];

/**
 * A file where a note's text has it. Once it is up it is drawn the way a
 * message draws its files, a picture or a video as wide as the note says
 * (dragged wider or narrower by its edges, or set at a click from its
 * toolbar), a sound to play, a file to download. While it goes up from this
 * device it shows how far it has got. One the note names but nobody has the
 * file for (someone else's still on its way, or one that never made it up)
 * says so.
 */
export function NoteFile({ meta, name, pending, onRemove, onRetry, width = 100, onResize }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const visual = !!meta && (meta.type.startsWith("image/") || meta.type.startsWith("video/"));
  const resizable = visual && !!onResize;
  const shown = live ?? width;

  /** The line the file sits on: its width is what a percentage is of. */
  const line = (): HTMLElement | null => root.current?.closest<HTMLElement>("[data-b='file'], [data-note-file-line]") ?? null;
  const show = (w: number | null): void => {
    const el = line();
    if (!el) return;
    if (w === null || w >= 100) el.style.removeProperty("--file-w");
    else el.style.setProperty("--file-w", `${w}%`);
  };

  const grab = (side: "start" | "end") => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !onResize) return;
    const el = line();
    const box = root.current?.getBoundingClientRect();
    if (!el || !box) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rtl = getComputedStyle(el).direction === "rtl";
    // the picture is centred, so it grows by as much on the other side too
    const sign = (side === "end") !== rtl ? 2 : -2;
    const from = e.clientX;
    const start = box.width;
    const full = el.clientWidth || 1;
    let now = shown;
    const move = (ev: PointerEvent): void => {
      const px = start + sign * (ev.clientX - from);
      now = Math.round(Math.max(FILE_MIN_WIDTH, Math.min(100, (px / full) * 100)));
      setLive(now);
      show(now);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLive(null);
      if (now !== width) onResize(now);
      else show(width);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // the arrow keys move a handle too, five percent at a time
  const key = (side: "start" | "end") => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onResize) return;
    const rtl = line() ? getComputedStyle(line()!).direction === "rtl" : false;
    const out = side === "end" ? (rtl ? "ArrowLeft" : "ArrowRight") : rtl ? "ArrowRight" : "ArrowLeft";
    const step = e.key === out ? 5 : e.key === "ArrowLeft" || e.key === "ArrowRight" ? -5 : e.key === "Home" ? -100 : e.key === "End" ? 100 : 0;
    if (!step) return;
    e.preventDefault();
    onResize(Math.max(FILE_MIN_WIDTH, Math.min(100, width + step)));
  };

  let body;
  if (meta) {
    body = <Attachments list={[meta]} fill={visual} />;
  } else if (pending) {
    const percent = Math.round(pending.progress * 100);
    body = (
      <div className={s.fileWait} data-error={pending.error ? "" : undefined}>
        {pending.error ? <AlertCircle size={20} className={s.fileWaitIcon} aria-hidden="true" /> : <FileIcon size={20} className={s.fileWaitIcon} aria-hidden="true" />}
        <div className={s.fileWaitText}>
          <span className={s.fileWaitName} dir="auto" title={pending.name}>{pending.name}</span>
          {pending.error ? (
            <span className={s.fileWaitError} role="alert">{pending.error}</span>
          ) : (
            <span className={s.fileWaitBar} role="progressbar" aria-label={t("notes.file.uploading", { name: pending.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ width: `${Math.max(4, percent)}%` }} />
            </span>
          )}
        </div>
        {pending.error && onRetry ? (
          <button type="button" className={s.fileAct} onMouseDown={(e) => e.preventDefault()} onClick={onRetry} aria-label={t("notes.file.retry", { name: pending.name })} title={t("notes.file.retryShort")}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className={s.fileWait} data-missing="">
        <FileIcon size={20} className={s.fileWaitIcon} aria-hidden="true" />
        <div className={s.fileWaitText}>
          <span className={s.fileWaitName} dir="auto" title={name}>{name}</span>
          <span className={s.fileWaitNote}>{t("notes.file.notHere")}</span>
        </div>
      </div>
    );
  }
  return (
    <div ref={root} className={s.file} data-testid="note-file" data-visual={visual || undefined} data-resizing={live !== null || undefined} data-state={meta ? "ready" : pending ? (pending.error ? "failed" : "uploading") : "missing"}>
      {body}
      {resizable
        ? (["start", "end"] as const).map((side) => (
            <span
              key={side}
              className={s.grip}
              data-side={side}
              role="slider"
              tabIndex={0}
              aria-label={t("notes.file.width", { name })}
              aria-valuemin={FILE_MIN_WIDTH}
              aria-valuemax={100}
              aria-valuenow={shown}
              aria-valuetext={`${shown}%`}
              onPointerDown={grab(side)}
              onKeyDown={key(side)}
              data-testid={`note-file-grip-${side}`}
            />
          ))
        : null}
      {live !== null ? <span className={s.fileSize} aria-hidden="true">{live}%</span> : null}
      {resizable || onRemove ? (
        <div className={s.fileBar} role="toolbar" aria-label={t("notes.file.tools", { name })} onMouseDown={(e) => e.preventDefault()}>
          {resizable
            ? SIZES.map((size) => (
                <button key={size.width} type="button" className={s.fileBarSize} aria-pressed={shown === size.width} aria-label={size.label()} onClick={() => onResize?.(size.width)} data-testid={`note-file-size-${size.width}`}>
                  {/* on a narrow picture the sizes say how wide, which needs no words */}
                  <span className={s.sizeWord} aria-hidden="true">{size.label()}</span>
                  <span className={s.sizeShort} aria-hidden="true">{size.width}%</span>
                </button>
              ))
            : null}
          {onRemove ? (
            <button type="button" className={s.fileBarRemove} onClick={onRemove} aria-label={t("notes.file.remove", { name })} title={t("notes.file.removeShort")} data-testid="note-file-remove">
              <Trash2 size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The line a file sits on in a note that is only read: as wide as the note says for a picture, centred. */
export function NoteFileLine({ width, children }: { width?: number | undefined; children: React.ReactNode }) {
  return (
    <div className={s.fileLine} data-note-file-line="" style={width && width < 100 ? ({ "--file-w": `${width}%` } as React.CSSProperties) : undefined}>
      {children}
    </div>
  );
}

/** A picture this big with no small copy beside it is not fetched for a card: the card names it instead. */
const THUMB_MAX = 8 * 1024 * 1024;

/**
 * A file as a note's card in the list shows it: a picture as a small crop of
 * itself, anything else by its name.
 */
export function NoteFileThumb({ meta, name }: { meta: AttachmentMeta | undefined; name: string }) {
  const shown = meta && meta.type.startsWith("image/") ? (copyOf(meta) ?? (meta.size <= THUMB_MAX ? meta : null)) : null;
  const id = shown?.blob_id ?? "";
  const [url, setUrl] = useState<string | null>(() => (id ? (cachedURL(id) ?? null) : null));
  useEffect(() => {
    if (!shown) return;
    const ctrl = new AbortController();
    attachmentObjectURL(shown, ctrl.signal, PRIORITY.near)
      .then((u) => {
        if (!ctrl.signal.aborted) setUrl(u);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
    // the file is what it is by its id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // held while it is on the card, so the cache does not let go of it underneath
  useEffect(() => {
    if (!url || !id) return;
    if (!acquire(id, url)) {
      setUrl(null);
      return;
    }
    return () => release(id, url);
  }, [url, id]);
  if (!shown) {
    return (
      <span className={s.thumbFile}>
        <FileIcon size={14} aria-hidden="true" />
        <span dir="auto">{name}</span>
      </span>
    );
  }
  return <span className={s.thumb}>{url ? <img src={url} alt={meta?.alt || name} decoding="async" /> : null}</span>;
}
