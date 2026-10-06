import { ImageOff, Play } from "lucide-react";
import { useMemo, useState } from "react";
import type { CaseFile } from "@/api/moderation";
import { Spinner } from "@/components/common/Spinner";
import { mosaicLayout } from "@/components/chat/Attachments";
import { fitMedia, fitVideo } from "@/components/chat/fitMedia";
import { Lightbox, type LightboxItem } from "@/components/chat/Lightbox";
import { VideoPlayer } from "@/components/chat/VideoPlayer";
import { bugFileURL, useBugFileURL, type PrivateFileKind } from "@/lib/bugMedia";
import { bugFileName, isBugVideo } from "@/lib/bugs";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import chat from "@/components/chat/Chat.module.css";

/** How sharp the copy a message shows is fetched: twice the picture's size on the page, for sharp screens. */
const SHOWN_SIZE = 1024;

/**
 * The pictures and recordings sent in a case thread or a bug report, drawn
 * as a conversation draws its attachments: one picture at its own shape, two
 * or more sharing one grid, a recording in the same player, and the viewer
 * stepping through a message's pictures. They are fetched with this
 * session's token (lib/bugMedia), since nothing public serves them.
 */
export function ThreadFiles({ files, kind, from }: { files: CaseFile[]; kind: PrivateFileKind; from?: string | undefined }) {
  const toast = useUI((u) => u.toast);
  const [viewer, setViewer] = useState<{ items: LightboxItem[]; start: number } | null>(null);
  const pictures = useMemo(() => files.filter((f) => !isBugVideo(f.mime)), [files]);
  const tiles = pictures.length > 1 ? mosaicLayout(pictures.length) : null;

  // The viewer shows what it is given, so the full-size pictures are fetched first.
  const open = async (f: CaseFile) => {
    try {
      const urls = await Promise.all(pictures.map((p) => bugFileURL(p.id, undefined, kind)));
      setViewer({ items: pictures.map((p, i) => ({ name: bugFileName(p), type: p.mime, src: urls[i], from })), start: Math.max(0, pictures.indexOf(f)) });
    } catch {
      toast(t("bugs.card.fileFailed"), "error");
    }
  };

  return (
    <div className={chat.att} data-testid="thread-files">
      {tiles ? (
        <div className={chat.mosaic} data-count={pictures.length} data-testid="picture-grid">
          {pictures.map((f, i) => (
            <Picture key={f.id} file={f} kind={kind} tile={tiles[i]} onOpen={() => void open(f)} />
          ))}
        </div>
      ) : null}
      {files.map((f) =>
        isBugVideo(f.mime) ? <Recording key={f.id} file={f} kind={kind} /> : tiles ? null : <Picture key={f.id} file={f} kind={kind} onOpen={() => void open(f)} />,
      )}
      {viewer ? <Lightbox items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

function Picture({ file, kind, tile, onOpen }: { file: CaseFile; kind: PrivateFileKind; tile?: ReturnType<typeof mosaicLayout>[number] | undefined; onOpen: () => void }) {
  // a smaller copy would be the GIF's first frame alone
  const { url, failed, retry } = useBugFileURL(file.id, file.mime === "image/gif" ? undefined : SHOWN_SIZE, true, kind);
  const dims = fitMedia(file.width ?? undefined, file.height ?? undefined);
  const box = tile ? { gridColumn: `span ${tile.col}`, gridRow: `span ${tile.row}`, ...(tile.ratio ? { aspectRatio: tile.ratio } : {}) } : { width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` };
  const name = bugFileName(file);
  return (
    <div className={chat.imgWrap} style={box} data-testid="thread-picture">
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          role="button"
          tabIndex={0}
          aria-label={t("bugs.card.openPicture", { name })}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
        />
      ) : failed ? (
        <button type="button" className={chat.imgPlaceholder} onClick={retry} aria-label={t("bugs.card.retryPicture", { name })}>
          <ImageOff size={22} aria-hidden="true" />
        </button>
      ) : (
        <span className={chat.imgPlaceholder}>
          <Spinner size={20} />
        </span>
      )}
    </div>
  );
}

/** A recording: a frame the player's shape that loads it when pressed, then the conversation's own player. */
function Recording({ file, kind }: { file: CaseFile; kind: PrivateFileKind }) {
  const [wanted, setWanted] = useState(false);
  const { url, failed, retry } = useBugFileURL(file.id, undefined, wanted, kind);
  const dims = fitVideo(file.width ?? 640, file.height ?? 360);
  const name = bugFileName(file);
  if (url) {
    return (
      <div className={chat.mediaSlot}>
        <VideoPlayer src={url} name={name} width={file.width ?? undefined} height={file.height ?? undefined} />
      </div>
    );
  }
  return (
    <div className={chat.mediaSlot}>
      <div className={chat.videoPending} style={{ width: dims.width, aspectRatio: `${dims.width} / ${dims.height}` }}>
        {failed ? (
          <button className={chat.videoLoad} onClick={retry}>
            {t("bugs.card.videoFailed")}
          </button>
        ) : wanted ? (
          <span className={chat.videoLoading}>
            <Spinner size={20} /> {t("chat.attachments.loadingNamed", { name, size: formatBytes(file.size) })}
          </span>
        ) : (
          <button className={chat.videoLoad} onClick={() => setWanted(true)} data-testid="thread-video">
            <Play size={20} /> {t("chat.attachments.loadVideo", { size: formatBytes(file.size) })}
          </button>
        )}
      </div>
    </div>
  );
}
