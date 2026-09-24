import { File as FileIcon, FileAudio, FileVideo, X } from "lucide-react";
import type { PendingUpload } from "@/stores/messages";
import { discardPending } from "@/components/composer/send";
import { formatBytes } from "@/lib/time";
import { t } from "@/i18n";
import s from "./Chat.module.css";

/**
 * A message's files on their way up, in the place the message will have in
 * the list: what they are, a bar, how far along, how fast, and a way to stop.
 */
export function UploadCard({ channelId, tmpId, upload, failed }: { channelId: string; tmpId: string; upload: PendingUpload; failed: boolean }) {
  const files = upload.files;
  const first = files[0];
  const name = files.length === 1 ? (first?.name ?? "") : t("chat.upload.files", { count: files.length });
  const fraction = upload.total > 0 ? Math.min(1, upload.loaded / upload.total) : upload.done ? 1 : 0;
  const pct = upload.done ? 100 : Math.floor(fraction * 100);
  const picture = files.find((f) => f.preview && f.type.startsWith("image/"));
  const Icon = first?.type.startsWith("video/") ? FileVideo : first?.type.startsWith("audio/") ? FileAudio : FileIcon;
  const going = !upload.done && !failed;
  return (
    <div className={s.upload} data-failed={failed || undefined} data-done={upload.done || undefined} data-testid="upload-card">
      <span className={s.uploadThumb} data-more={files.length > 1 ? `+${files.length - 1}` : undefined} aria-hidden="true">
        {picture?.preview ? <img src={picture.preview} alt="" /> : <Icon size={22} />}
      </span>
      <div className={s.uploadMain}>
        <div className={s.uploadTop}>
          <span className={s.uploadName} title={files.map((f) => f.name).join("\n")}>
            {name}
          </span>
          <span className={s.uploadSize}>{formatBytes(upload.total)}</span>
        </div>
        <div className={s.uploadBar} role="progressbar" aria-label={t("chat.upload.uploading", { name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${failed ? Math.max(pct, 2) : pct}%` }} />
        </div>
        <div className={s.uploadStats}>
          {failed && upload.error ? (
            <span className={s.uploadError}>{upload.error}</span>
          ) : upload.done ? (
            <span>{t("messageRow.sending")}</span>
          ) : (
            <span data-testid="upload-progress">
              {pct}%{upload.speed > 0 ? ` · ${t("chat.upload.speed", { size: formatBytes(upload.speed) })}` : ""}
            </span>
          )}
          {going ? <span>{t("chat.upload.ofTotal", { sent: formatBytes(upload.loaded), total: formatBytes(upload.total) })}</span> : null}
        </div>
      </div>
      {going ? (
        <button type="button" className={s.uploadCancel} onClick={() => discardPending(channelId, tmpId)} aria-label={t("chat.upload.cancel")} title={t("chat.upload.cancel")} data-testid="upload-cancel">
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
