import { Download, FileIcon, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { DecryptError } from "@/crypto/keys";
import type { AttachmentMeta } from "@/crypto/message";
import { saveAttachment } from "@/lib/download";
import { INLINE_MAX, acquire, attachmentObjectURL, cachedURL, release } from "@/lib/mediaCache";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { Spinner } from "@/components/common/Spinner";
import { AudioPlayer } from "./AudioPlayer";
import { FavoriteButton } from "./FavoriteButton";
import { Lightbox, type LightboxItem } from "./Lightbox";
import { VideoPlayer } from "./VideoPlayer";
import { fitMedia, fitVideo } from "./fitMedia";
import s from "./Chat.module.css";

import { t as tr_ } from "@/i18n";
export { fitMedia };

/**
 * Media up to this size loads by itself as it nears the screen. Anything
 * bigger waits to be asked for, since every copy of the app showing the
 * message would otherwise download and decrypt all of it.
 */
const AUTO_LOAD_MAX = 25 * 1024 * 1024;
/** How near the screen a picture or clip has to come before it is fetched. */
const NEAR = "600px 0px";
/**
 * How far off screen a loaded one may drift before it lets go of its
 * decrypted copy. Kept while mounted, every picture scrolled past stayed in
 * memory for as long as the conversation was open, and a long photo channel
 * on a phone ended in the tab being killed. Let go, it can be evicted, and
 * coming back is instant while it has not been.
 */
const FAR = "2500px 0px";

type LoadError = "load" | "decrypt";

/**
 * Decrypts an attachment while it is near the screen (`auto`) or once asked
 * to (`load`), and lets go of it again when it is far away — unless it is
 * playing, which it goes on doing out of view.
 */
function useDecrypted(att: AttachmentMeta, ref: RefObject<HTMLElement | null>, auto: boolean): { url: string | null; error: LoadError | null; wanted: boolean; load: () => void; retry: () => void } {
  const [url, setUrl] = useState<string | null>(cachedURL(att.blob_id) ?? null);
  const [error, setError] = useState<LoadError | null>(null);
  const [wanted, setWanted] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || url || error || started.current) return;
    started.current = true;
    // Not dropped when the effect runs again: a render that only rebuilt the
    // attachment's object must not orphan the download it already started.
    attachmentObjectURL(att)
      .then((u) => {
        started.current = false;
        setUrl(u);
      })
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
  // Near and far are measured against the message list that scrolls, not the
  // window: seen from the window, everything the list has scrolled out of its
  // box is clipped away, however near it is.
  // near the screen: wanted, when it loads by itself
  useEffect(() => {
    const el = ref.current;
    if (!auto || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setWanted(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setWanted(true);
    }, { root: el.closest("[data-scroller]"), rootMargin: NEAR });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, auto]);
  // far from it: let go, unless it is playing
  useEffect(() => {
    const el = ref.current;
    if (!url || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) return;
      const media = el.querySelector<HTMLMediaElement>("video, audio");
      if (media && !media.paused) return;
      setUrl(null);
      setWanted(false);
    }, { root: el.closest("[data-scroller]"), rootMargin: FAR });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, url]);
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

function ImageAttachment({ att, onOpen }: { att: AttachmentMeta; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load, retry } = useDecrypted(att, ref, auto);
  const [revealed, setRevealed] = useState(!att.spoiler);
  const dims = fitMedia(att.w, att.h);
  const open = () => {
    if (url) onOpen();
  };
  return (
    <div ref={ref} className={s.imgWrap} data-spoiler={!revealed} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }} onClick={() => (revealed ? open() : setRevealed(true))}>
      {att.type === "image/gif" && revealed ? <FavoriteButton url={`attach:${att.blob_id}`} w={att.w} h={att.h} att={att} className={s.favStar} /> : null}
      {url ? (
        // the picture is the way into the viewer, for a keyboard as for a pointer
        <img
          src={url}
          alt={att.alt || att.name}
          width={dims.width}
          height={dims.height}
          data-image-src={url}
          data-image-name={att.name}
          role={revealed ? "button" : undefined}
          tabIndex={revealed ? 0 : -1}
          aria-haspopup={revealed ? "dialog" : undefined}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            open();
          }}
        />
      ) : (
        <div className={s.imgPlaceholder}>
          {error ? (
            <LoadFailed error={error} what="image" onRetry={retry} />
          ) : wanted || auto ? (
            // a webhook's file is fetched as it is, with nothing to decrypt
            att.plain ? tr_("chat.pins.loading") : tr_("chat.attachments.decryptingShort")
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
      {!revealed ? (
        <button
          type="button"
          className={s.spoilerTag}
          aria-label={tr_("render.spoilerHidden")}
          onClick={(e) => {
            e.stopPropagation();
            setRevealed(true);
          }}
        >
          <span>{tr_("composer.composer.spoiler")}</span>
        </button>
      ) : null}
    </div>
  );
}

function VideoAttachment({ att }: { att: AttachmentMeta }) {
  // the whole file has to come down and be decrypted before it can play at all
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  // Waiting for the row to near the screen, as pictures do. Starting on mount
  // downloaded and decrypted every clip in the loaded history at once, each of
  // them held in memory from that moment on.
  const { url, error, wanted, load, retry } = useDecrypted(att, ref, auto);
  // the same frame the player will have, so nothing jumps when it arrives
  const dims = fitVideo(att.w ?? 640, att.h ?? 360);
  return (
    <div ref={ref} className={s.mediaSlot}>
      {url ? (
        <VideoPlayer src={url} name={att.name} width={att.w} height={att.h} spoiler={att.spoiler ?? false} />
      ) : (
        <div className={s.videoPending} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }}>
          {error ? (
            <LoadFailed error={error} what="video" onRetry={retry} />
          ) : wanted || auto ? (
            <span className={s.videoLoading}><Spinner size={20} /> {tr_(att.plain ? "chat.attachments.loadingNamed" : "chat.attachments.decryptingNamed", { name: att.name, size: formatBytes(att.size) })}</span>
          ) : (
            <button className={s.videoLoad} onClick={load}>
              <Play size={20} /> {tr_("chat.attachments.loadVideo", { size: formatBytes(att.size) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AudioAttachment({ att }: { att: AttachmentMeta }) {
  const ref = useRef<HTMLDivElement>(null);
  const auto = att.size <= AUTO_LOAD_MAX;
  const { url, error, wanted, load, retry } = useDecrypted(att, ref, auto);
  return (
    <div ref={ref} className={s.audio}>
      {url ? (
        <AudioPlayer src={url} name={att.name} size={att.size} duration={att.duration} waveKey={att.blob_id} />
      ) : error ? (
        <span className={s.fileSize}><LoadFailed error={error} what="audio" onRetry={retry} /></span>
      ) : wanted || auto ? (
        <span className={s.fileSize}>{tr_(att.plain ? "chat.attachments.loadingFile" : "chat.attachments.decrypting", { name: att.name })}</span>
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
      <FileIcon size={36} className={s.fileIcon} aria-hidden="true" />
      <div className={s.fileText}>
        {/* the name downloads too; the button beside it is the one a keyboard reaches */}
        <button type="button" className={s.fileName} onClick={() => void download()} tabIndex={-1} dir="auto" title={att.name}>{att.name}</button>
        <span className={s.fileSize}>{busy ? tr_("chat.attachments.downloadingPercent", { percent, size: formatBytes(att.size) }) : formatBytes(att.size)}</span>
      </div>
      <button className={s.dl} aria-label={tr_("chat.attachments.downloadNamed", { name: att.name })} title={tr_("chat.attachments.download")} onClick={() => void download()} disabled={busy}>{busy ? <Spinner size={20} /> : <Download size={20} />}</button>
    </div>
  );
}

export function Attachments({ list, from }: { list: AttachmentMeta[]; from?: string }) {
  // The message's pictures are one set in the viewer, a step apart. A spoiler
  // is left out unless it is the one opened: stepping onto it would give it away.
  const [viewing, setViewing] = useState<string | null>(null);
  const pictures = useMemo(() => list.filter((a) => a.size <= INLINE_MAX && (a.type || "").startsWith("image/")), [list]);
  const gallery: LightboxItem[] = useMemo(
    () => pictures.filter((a) => !a.spoiler || a.blob_id === viewing).map((a) => ({ name: a.name, type: a.type, att: a, from })),
    [pictures, viewing, from],
  );
  return (
    <div className={s.att}>
      {list.map((att) => {
        const t = att.type || "";
        // showing or playing a file means holding all of it, so past a point it is only offered as a download
        const inline = att.size <= INLINE_MAX;
        if (inline && t.startsWith("image/")) return <ImageAttachment key={att.blob_id} att={att} onOpen={() => setViewing(att.blob_id)} />;
        if (inline && t.startsWith("video/")) return <VideoAttachment key={att.blob_id} att={att} />;
        if (inline && t.startsWith("audio/")) return <AudioAttachment key={att.blob_id} att={att} />;
        return <FileAttachment key={att.blob_id} att={att} />;
      })}
      {viewing ? <Lightbox items={gallery} start={Math.max(0, gallery.findIndex((g) => g.att?.blob_id === viewing))} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
