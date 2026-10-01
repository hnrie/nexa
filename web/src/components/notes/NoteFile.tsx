import { AlertCircle, FileIcon, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttachmentMeta } from "@/crypto/message";
import { Attachments } from "@/components/chat/Attachments";
import { acquire, attachmentObjectURL, cachedURL, PRIORITY, release } from "@/lib/mediaCache";
import { copyOf } from "@/lib/pictureCopy";
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
}

/**
 * A file where a note's text has it. Once it is up it is drawn the way a
 * message draws its files: a picture to open, a video or a sound to play, a
 * file to download. While it goes up from this device it shows how far it
 * has got. One the note names but nobody has the file for (someone else's
 * still on its way, or one that never made it up) says so.
 */
export function NoteFile({ meta, name, pending, onRemove, onRetry }: Props) {
  let body;
  if (meta) {
    body = <Attachments list={[meta]} />;
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
    <div className={s.file} data-testid="note-file" data-state={meta ? "ready" : pending ? (pending.error ? "failed" : "uploading") : "missing"}>
      {body}
      {onRemove ? (
        <button
          type="button"
          className={s.fileRemove}
          // the caret stays where it was in the note
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRemove}
          aria-label={t("notes.file.remove", { name })}
          title={t("notes.file.removeShort")}
          data-testid="note-file-remove"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
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
