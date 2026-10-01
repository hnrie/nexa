import { Bug, ChevronDown, ImageOff, Play } from "lucide-react";
import { useId, useState } from "react";
import type { BugContext, BugFile, BugStatus, MemberBug, StaffBug } from "@/api/bugs";
import type { People } from "@/api/moderation";
import { Spinner } from "@/components/common/Spinner";
import { Lightbox, type LightboxItem } from "@/components/chat/Lightbox";
import { VideoPlayer } from "@/components/chat/VideoPlayer";
import { PersonChip } from "@/components/nexa/NexaBits";
import { bugFileURL, type PrivateFileKind, useBugFileURL } from "@/lib/bugMedia";
import { bugFileName, bugNumber, bugStatusLabel, bugStatusTone, contextRows, isBugVideo } from "@/lib/bugs";
import { useRenderCtx } from "@/lib/markdownCtx";
import { fullDate } from "@/lib/moderation";
import { formatBytes, formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import s from "./Bugs.module.css";

/** A report's status, as a small coloured label. */
export function BugStatusChip({ status, className }: { status: BugStatus; className?: string | undefined }) {
  return (
    <span className={[s.status, className ?? ""].join(" ")} data-tone={bugStatusTone(status) || undefined} data-status={status}>
      {bugStatusLabel(status)}
    </span>
  );
}

function isStaffBug(b: MemberBug | StaffBug): b is StaffBug {
  return "user_id" in b;
}

/**
 * A report as either side reads it, at the top of its thread: the subject and
 * where it stands, what the reporter wrote, their screenshots and recording,
 * and the facts about their device if they sent them. Staff also see who sent
 * it, as a way to their profile.
 */
export function BugReportCard({ report, people }: { report: MemberBug | StaffBug; people: People }) {
  const ctx = useRenderCtx();
  const staff = isStaffBug(report);
  return (
    <article className={s.report} aria-label={t("bugs.card.label", { number: bugNumber(report.number) })} data-testid="bug-report-card">
      <div className={s.reportTop}>
        <span className={s.reportIcon} aria-hidden="true">
          <Bug size={18} />
        </span>
        <div className={s.reportTitles}>
          <h3 className={s.reportSubject} dir="auto">
            {report.subject}
          </h3>
          <div className={s.reportMeta}>
            <span>{bugNumber(report.number)}</span>
            {staff ? <PersonChip id={report.user_id} person={people[report.user_id]} size={18} withUsername /> : null}
            <time dateTime={new Date(report.created_at).toISOString()} title={fullDate(report.created_at)}>
              {formatTimestamp(report.created_at)}
            </time>
          </div>
        </div>
        <BugStatusChip status={report.status} />
      </div>
      <div className={s.reportBody} dir="auto">
        <Markdown source={report.description} ctx={ctx} />
      </div>
      {report.attachments.length ? <BugGallery files={report.attachments} from={staff ? report.reporter_display_name || report.reporter_username : undefined} /> : null}
      <BugFacts context={report.context} />
    </article>
  );
}

/** The facts a report came with, folded away until asked for. */
export function BugFacts({ context }: { context: BugContext }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = contextRows(context);
  if (!rows.length) return <p className={s.hint}>{t("bugs.card.noDetails")}</p>;
  return (
    <div className={s.details}>
      <button type="button" className={s.disclose} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} data-testid="bug-card-details">
        {open ? t("bugs.card.hideDetails") : t("bugs.card.showDetails")}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <dl className={s.facts} id={id}>
          {rows.map((r) => (
            <FactRow key={r.key} label={r.label} value={r.value} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd dir="auto">{value}</dd>
    </>
  );
}

/**
 * A report's files: pictures as thumbnails that open full size in the
 * picture viewer, and a recording as a tile that loads and plays in place.
 */
export function BugGallery({ files, from, kind = "bugs" }: { files: BugFile[]; from?: string | undefined; kind?: PrivateFileKind }) {
  const toast = useUI((u) => u.toast);
  const [viewer, setViewer] = useState<{ items: LightboxItem[]; start: number } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const pictures = files.filter((f) => !isBugVideo(f.mime));

  // The viewer shows what it is given, so the full-size pictures are fetched
  // first, the one tapped among them.
  const openPicture = async (f: BugFile) => {
    setOpening(f.id);
    try {
      const urls = await Promise.all(pictures.map((p) => bugFileURL(p.id, undefined, kind)));
      setViewer({ items: pictures.map((p, i) => ({ name: bugFileName(p), type: p.mime, src: urls[i], from })), start: pictures.indexOf(f) });
    } catch {
      toast(t("bugs.card.fileFailed"), "error");
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <ul className={s.gallery} aria-label={t("bugs.card.files", { count: files.length })} style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="bug-gallery">
        {files.map((f) =>
          isBugVideo(f.mime) ? (
            playing === f.id ? (
              <li key={f.id} className={s.player}>
                <PlayingVideo file={f} kind={kind} />
              </li>
            ) : (
              <li key={f.id}>
                <button type="button" className={[s.shot, s.shotVideo].join(" ")} onClick={() => setPlaying(f.id)} aria-label={t("bugs.card.playVideo", { name: bugFileName(f), size: formatBytes(f.size) })} data-testid="bug-video">
                  <span className={s.play} aria-hidden="true">
                    <Play size={18} />
                  </span>
                  <span aria-hidden="true">{formatBytes(f.size)}</span>
                </button>
              </li>
            )
          ) : (
            <li key={f.id}>
              <Thumb file={f} kind={kind} busy={opening === f.id} onOpen={() => void openPicture(f)} />
            </li>
          ),
        )}
      </ul>
      {viewer ? <Lightbox items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

function Thumb({ file, kind, busy, onOpen }: { file: BugFile; kind: PrivateFileKind; busy: boolean; onOpen: () => void }) {
  const { url, failed, retry } = useBugFileURL(file.id, 512, true, kind);
  return (
    <button type="button" className={s.shot} onClick={failed ? retry : onOpen} aria-label={failed ? t("bugs.card.retryPicture", { name: bugFileName(file) }) : t("bugs.card.openPicture", { name: bugFileName(file) })} data-testid="bug-thumb">
      {url ? <img src={url} alt="" draggable={false} /> : failed ? <ImageOff size={22} aria-hidden="true" /> : <Spinner size={18} />}
      {busy ? (
        <span className={s.shotBusy}>
          <Spinner size={20} />
        </span>
      ) : null}
    </button>
  );
}

function PlayingVideo({ file, kind }: { file: BugFile; kind: PrivateFileKind }) {
  const { url, failed, retry } = useBugFileURL(file.id, undefined, true, kind);
  if (failed) {
    return (
      <button type="button" className={[s.shot, s.shotVideo].join(" ")} onClick={retry}>
        {t("bugs.card.videoFailed")}
      </button>
    );
  }
  if (!url) {
    return (
      <div className={s.shot}>
        <Spinner size={22} label={t("chat.pins.loading")} />
      </div>
    );
  }
  return <VideoPlayer src={url} name={bugFileName(file)} />;
}

/** A small strip of a report's files, for the rows of a list. */
export function BugThumbStrip({ files, max = 3 }: { files: BugFile[]; max?: number }) {
  const shown = files.slice(0, max);
  const more = files.length - shown.length;
  return (
    <span className={s.strip} aria-label={t("bugs.card.files", { count: files.length })}>
      {shown.map((f) => (isBugVideo(f.mime) ? <span key={f.id} className={[s.stripItem, s.stripVideo].join(" ")} aria-hidden="true"><Play size={12} /></span> : <StripThumb key={f.id} file={f} />))}
      {more > 0 ? <span className={[s.stripItem, s.stripMore].join(" ")} aria-hidden="true">+{more}</span> : null}
    </span>
  );
}

function StripThumb({ file }: { file: BugFile }) {
  const { url } = useBugFileURL(file.id, 64);
  return <span className={s.stripItem} aria-hidden="true">{url ? <img src={url} alt="" draggable={false} /> : null}</span>;
}
