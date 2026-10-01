import { CircleCheck, CircleDot, Clock, Film, History, ImagePlus, Lock, LockOpen, RotateCcw, SendHorizontal, ShieldAlert, X, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { UploadOptions } from "@/api/client";
import type { CaseFile, CaseMessage, ModAction, People } from "@/api/moderation";
import { BugGallery } from "@/components/bugs/BugReportCard";
import { Avatar } from "@/components/common/Avatar";
import { describeError } from "@/lib/errors";
import { useRenderCtx } from "@/lib/markdownCtx";
import { personName, systemLineText } from "@/lib/moderation";
import { formatDateDivider, formatTime, formatTimestamp, sameDay } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { NexaAvatar, OfficialBadge } from "./NexaBits";
import s from "./Nexa.module.css";

/** The most a line can hold; the server refuses anything longer. */
export const MAX_CASE_MESSAGE = 2000;
/** Lines from the same writer this close together share one header. */
const GROUP_GAP = 7 * 60_000;

/** How many files one line carries; the server holds a line to the same. */
export const MAX_CASE_FILES = 4;
/** What a thread takes: pictures and short recordings, as bug reports do. */
const FILE_TYPES = "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime";

/** A line of a thread: a moderation case's, or a bug report's, which has the same shape. */
export type ThreadLine = Pick<CaseMessage, "id" | "author_id" | "kind" | "body" | "created_at"> & { event: string; files?: CaseFile[] | undefined };

/** Puts one file up for a line not sent yet; a thread without it takes words alone. */
export type CaseUpload = (file: Blob, name: string, opts?: Pick<UploadOptions, "onProgress" | "signal">) => Promise<CaseFile>;

interface Props {
  messages: ThreadLine[];
  people: People;
  perspective: "member" | "staff";
  /** The case's action, which some of its system lines name; a bug report has none. */
  action?: ModAction;
  /** Shown above the first line: the case itself. */
  header?: ReactNode;
  /** Sends a line and the files that go with it; the composer is left out without it. */
  onSend?: (body: string, files: CaseFile[]) => Promise<void>;
  /** Lets the composer add pictures and recordings. */
  upload?: CaseUpload | undefined;
  /** Said over the composer, about who reads what is written here. */
  composerNote?: ReactNode;
  /** Replaces the composer when writing is not possible: a sentence, and maybe a way to change that. */
  closedNote?: ReactNode;
  /** Called when the newest line is on screen, so it can be marked read. */
  onSeen?: () => void;
  /** What the empty thread and the composer say, when not a case's words. */
  emptyNote?: string;
  placeholder?: string;
}

/**
 * A case's thread: the member, the staff (who write as Nexa, with their own
 * name shown), and a line for everything that happened to the case.
 */
export function CaseThread({ messages, people, perspective, action, header, onSend, upload, composerNote, closedNote, onSeen, emptyNote, placeholder }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const seenRef = useRef(onSeen);
  seenRef.current = onSeen;
  const last = messages[messages.length - 1]?.id;

  // Follow new lines while the reader is at the bottom; leave them alone when
  // they have scrolled up to read something earlier.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last, header]);
  useEffect(() => {
    if (atBottom.current) seenRef.current?.();
  }, [last]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (bottom && !atBottom.current) seenRef.current?.();
    atBottom.current = bottom;
  };

  return (
    <div className={s.thread}>
      <div className={s.threadScroll} ref={scroller} onScroll={onScroll} data-testid="case-thread">
        {header ? <div className={s.threadHeader}>{header}</div> : null}
        {messages.length === 0 ? <p className={s.threadEmpty}>{emptyNote ?? (perspective === "member" ? t("nexa.thread.emptyMember") : t("nexa.thread.emptyStaff"))}</p> : null}
        <ol className={s.lines}>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(prev.created_at, m.created_at);
            const grouped = !!prev && !newDay && m.kind !== "system" && prev.kind === m.kind && prev.author_id === m.author_id && m.created_at - prev.created_at < GROUP_GAP;
            return (
              <Fragment key={m.id}>
                {newDay ? (
                  <li className={s.dayDivider} role="separator">
                    <span>{formatDateDivider(m.created_at)}</span>
                  </li>
                ) : null}
                {m.kind === "system" ? (
                  <SystemLine m={m} people={people} action={action} perspective={perspective} />
                ) : (
                  <Line m={m} people={people} perspective={perspective} grouped={grouped} />
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>
      {onSend ? (
        <Composer onSend={onSend} upload={upload} note={composerNote} placeholder={placeholder} />
      ) : closedNote ? (
        <div className={s.threadClosed} data-testid="case-locked">
          {closedNote}
        </div>
      ) : null}
    </div>
  );
}

function Line({ m, people, perspective, grouped }: { m: ThreadLine; people: People; perspective: "member" | "staff"; grouped: boolean }) {
  const ctx = useRenderCtx();
  const openModal = useUI((u) => u.openModal);
  const author = people[m.author_id];
  const staff = m.kind === "staff";
  // The member reads staff replies as Nexa's, with the name of whoever wrote
  // them; the staff see each other as themselves.
  const asNexa = staff && perspective === "member";
  const name = asNexa ? "Nexa" : personName(author);
  const openAuthor = () => author && !author.deleted && openModal("profile", { userId: m.author_id });
  return (
    <li className={s.line} data-grouped={grouped || undefined} data-kind={m.kind} data-testid={`case-line-${m.kind}`}>
      {grouped ? (
        <time className={s.lineGutter} dateTime={new Date(m.created_at).toISOString()} title={formatTimestamp(m.created_at)}>
          {formatTime(m.created_at)}
        </time>
      ) : (
        <span className={s.lineAvatar}>
          {asNexa ? (
            <NexaAvatar size={36} />
          ) : (
            <button type="button" className={s.bare} onClick={openAuthor} aria-label={name}>
              <Avatar id={m.author_id} avatarId={author?.avatar_id ?? null} name={name} size={36} />
            </button>
          )}
        </span>
      )}
      <div className={s.lineBody}>
        {!grouped ? (
          <div className={s.lineHead}>
            {asNexa ? (
              <>
                <span className={s.lineName}>Nexa</span>
                <OfficialBadge compact />
                <span className={s.staffCredit}>
                  {t("nexa.thread.sentBy")}{" "}
                  <button type="button" className={s.inlineLink} onClick={openAuthor}>
                    {personName(author)}
                  </button>
                </span>
              </>
            ) : (
              <>
                <button type="button" className={[s.lineName, s.inlineLink].join(" ")} onClick={openAuthor}>
                  {name}
                </button>
                {staff ? <span className={s.staffTag}>{t("nexa.thread.asNexa")}</span> : null}
              </>
            )}
            <time className={s.lineTime} dateTime={new Date(m.created_at).toISOString()}>
              {formatTimestamp(m.created_at)}
            </time>
          </div>
        ) : null}
        {m.body ? (
          <div className={s.lineText} dir="auto">
            <Markdown source={m.body} ctx={ctx} />
          </div>
        ) : null}
        {m.files?.length ? (
          <div className={s.lineFiles}>
            <BugGallery files={m.files} from={name} kind="cases" />
          </div>
        ) : null}
      </div>
    </li>
  );
}

const SYSTEM_ICONS: Record<string, LucideIcon> = { lifted: LockOpen, closed: CircleCheck, reopened: RotateCcw, expired: Clock, replaced: ShieldAlert, status: CircleDot };

function SystemLine({ m, people, action, perspective }: { m: ThreadLine; people: People; action: ModAction | undefined; perspective: "member" | "staff" }) {
  const Icon = SYSTEM_ICONS[m.event] ?? History;
  const icon = <Icon size={16} />;
  const text = systemLineText(m, people, action, perspective);
  return (
    <li className={s.systemLine} data-event={m.event} data-status={m.event === "status" ? m.body : undefined}>
      <span className={s.systemIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={s.systemText}>{text}</span>
      <time className={s.lineTime} dateTime={new Date(m.created_at).toISOString()}>
        {formatTimestamp(m.created_at)}
      </time>
    </li>
  );
}

/** A file picked for the next line, on its way up or there. */
interface Staged {
  key: string;
  file: File;
  /** The picture itself, for its tile, until it is sent or dropped. */
  preview: string | null;
  progress: number;
  done?: CaseFile;
  failed?: string;
  abort: AbortController;
}

function Composer({ onSend, upload, note, placeholder = t("nexa.thread.placeholder") }: { onSend: (body: string, files: CaseFile[]) => Promise<void>; upload: CaseUpload | undefined; note?: ReactNode; placeholder?: string | undefined }) {
  const toast = useUI((u) => u.toast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const length = [...text].length;
  const over = length > MAX_CASE_MESSAGE;
  const uploading = staged.some((f) => !f.done && !f.failed);
  const ready = staged.filter((f) => f.done);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  // what is still staged when the thread closes is let go: its uploads stop, its pictures are freed
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  useEffect(
    () => () => {
      for (const f of stagedRef.current) {
        f.abort.abort();
        if (f.preview) URL.revokeObjectURL(f.preview);
      }
    },
    [],
  );

  const add = (files: File[]) => {
    if (!upload || !files.length) return;
    const room = MAX_CASE_FILES - staged.length;
    if (room <= 0) {
      toast(t("nexa.thread.tooManyFiles", { count: MAX_CASE_FILES }), "error");
      return;
    }
    const accepted = files.filter((f) => FILE_TYPES.split(",").includes(f.type));
    if (accepted.length < files.length) toast(t("nexa.thread.fileType"), "error");
    if (accepted.length > room) toast(t("nexa.thread.tooManyFiles", { count: MAX_CASE_FILES }), "error");
    for (const file of accepted.slice(0, room)) {
      const key = `${file.name}:${file.size}:${Math.random().toString(36).slice(2)}`;
      const item: Staged = { key, file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, progress: 0, abort: new AbortController() };
      setStaged((cur) => [...cur, item]);
      upload(file, file.name, { signal: item.abort.signal, onProgress: (loaded, total) => setStaged((cur) => cur.map((x) => (x.key === key ? { ...x, progress: total ? loaded / total : 0 } : x))) })
        .then((done) => setStaged((cur) => cur.map((x) => (x.key === key ? { ...x, done, progress: 1 } : x))))
        .catch((err: unknown) => {
          if (item.abort.signal.aborted) return;
          setStaged((cur) => cur.map((x) => (x.key === key ? { ...x, failed: describeError(err, t("nexa.thread.uploadFailed")) } : x)));
        });
    }
  };

  const drop = (key: string) => {
    setStaged((cur) => {
      const gone = cur.find((x) => x.key === key);
      if (gone) {
        gone.abort.abort();
        if (gone.preview) URL.revokeObjectURL(gone.preview);
      }
      return cur.filter((x) => x.key !== key);
    });
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !ready.length) || over || busy || uploading) return;
    setBusy(true);
    try {
      await onSend(body, ready.map((f) => f.done!));
      setText("");
      for (const f of staged) if (f.preview) URL.revokeObjectURL(f.preview);
      setStaged([]);
    } catch (err) {
      toast(describeError(err, t("nexa.thread.couldNotSend")), "error");
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  // a screenshot pasted or dropped in goes with the next line
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!upload) return;
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!upload) return;
    e.preventDefault();
    setDragging(false);
    add([...e.dataTransfer.files]);
  };

  const canSend = (!!text.trim() || ready.length > 0) && !over && !busy && !uploading;
  return (
    <div
      className={s.composer}
      data-dragging={dragging || undefined}
      onDragOver={upload ? (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDragging(true); } } : undefined}
      onDragLeave={upload ? () => setDragging(false) : undefined}
      onDrop={upload ? onDrop : undefined}
    >
      {note ? <p className={s.composerNote}>{note}</p> : null}
      {staged.length ? (
        <ul className={s.staged} aria-label={t("nexa.thread.filesToSend")} data-testid="case-staged">
          {staged.map((f) => (
            <li key={f.key} className={s.stagedItem} data-failed={!!f.failed || undefined} title={f.failed ?? f.file.name}>
              {f.preview ? <img src={f.preview} alt="" draggable={false} /> : <Film size={22} aria-hidden="true" />}
              {!f.done && !f.failed ? <span className={s.stagedBar} style={{ inlineSize: `${Math.round(f.progress * 100)}%` }} aria-hidden="true" /> : null}
              <button type="button" className={s.stagedRemove} onClick={() => drop(f.key)} aria-label={t("nexa.thread.removeFile", { name: f.file.name })}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={s.composerBox} data-over={over || undefined}>
        {upload ? (
          <>
            <button type="button" className={s.attach} onClick={() => picker.current?.click()} disabled={busy || staged.length >= MAX_CASE_FILES} aria-label={t("nexa.thread.addFiles")} title={t("nexa.thread.addFiles")} data-testid="case-attach">
              <ImagePlus size={20} />
            </button>
            <input
              ref={picker}
              type="file"
              accept={FILE_TYPES}
              multiple
              hidden
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
              data-testid="case-file-input"
            />
          </>
        ) : null}
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="case-composer"
          disabled={busy}
        />
        {length > MAX_CASE_MESSAGE - 200 ? <span className={s.counter} data-over={over || undefined}>{MAX_CASE_MESSAGE - length}</span> : null}
        <button type="button" className={s.send} onClick={() => void send()} disabled={!canSend} aria-label={t("nexa.thread.send")} data-testid="case-send">
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  );
}

/** What stands where the composer was, once nobody can write in a case. */
export function ClosedNote({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <>
      <span className={s.closedText}>
        <Lock size={15} aria-hidden="true" />
        {text}
      </span>
      {action}
    </>
  );
}
