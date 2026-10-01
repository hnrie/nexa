import { ImagePlus, Paperclip } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { b64url } from "@/crypto/notes";
import { randomBytes } from "@/crypto/bytes";
import type { AttachmentMeta } from "@/crypto/message";
import { ToolButton, useFormatBench } from "@/components/composer/format/FormatEditor";
import type { FileHost } from "@/components/composer/format/surface";
import f from "@/components/composer/format/FormatEditor.module.css";
import { useMediaQuery } from "@/hooks/useIsMobile";
import { fitsUploadLimit, noteUploads, stage, uploadLimit, uploadStaged } from "@/lib/attachments";
import { describeError } from "@/lib/errors";
import { NOTE_MAX_CHARS, NOTE_MAX_FILES, NOTE_TITLE_MAX, fileIds, type NoteDoc } from "@/lib/notes/model";
import type { OpenNote } from "@/lib/notes/open";
import { formatBytes } from "@/lib/time";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { useLiveCursors } from "./LiveCursors";
import { NoteFile, type PendingUpload } from "./NoteFile";
import s from "./Notes.module.css";

/** How the page reaches whichever view of the note is showing: the editor, or the note as read. */
export interface NoteBridge {
  /** Someone else's changes, put together with this page's: shown in place of what is here. False when that cannot be done just now. */
  onRemote: (doc: NoteDoc) => boolean;
  /** What the page holds this instant. */
  read?: () => Partial<NoteDoc>;
}

export const IDLE_BRIDGE: NoteBridge = { onRemote: () => false };

/** How many files go up at once. */
const UPLOADS_AT_ONCE = 3;

/** A new file's id in the note's text: random, and nothing else. */
function newFileId(): string {
  return b64url.enc(randomBytes(9));
}

interface Props {
  noteId: string;
  note: OpenNote;
  initial: NoteDoc;
  bridge: React.MutableRefObject<NoteBridge>;
  /** The title as it is written, for the list and the bar. */
  onTitle: (title: string) => void;
  /** Where the caret starts: in the title of a note just made, nowhere otherwise. */
  autoFocus: "title" | null;
  /** What the bar holds before the tools (the way back, on a phone) and after them (who is here, the save state, sharing). */
  barStart?: ReactNode;
  barEnd: ReactNode;
  /** Who wrote in it last, and when: under the title. */
  byline: ReactNode;
}

/**
 * A note, being written: the formatting tools in the bar over it, its title,
 * and the writing surface, with its files drawn where its text has them and
 * everyone else's caret drawn where they are. Everything typed goes to the
 * note's session, which saves it a moment later and sends it on to whoever
 * else has the note open; what they write arrives through `bridge` and is
 * put in without moving the caret.
 */
export function NoteEditor({ noteId, note, initial, bridge, onTitle, autoFocus, barStart, barEnd, byline }: Props) {
  const session = note.session;
  const narrow = useMediaQuery("(max-width: 767px)");
  const toast = useUI((u) => u.toast);
  const [title, setTitle] = useState(initial.title);
  const titleRef = useRef(initial.title);
  const titleEl = useRef<HTMLTextAreaElement>(null);
  /** Where the title's selection goes back to once someone else's title has been put in. */
  const titleSel = useRef<[number, number] | null>(null);
  const [files, setFiles] = useState<Record<string, AttachmentMeta>>(initial.files);
  const filesRef = useRef(initial.files);
  const [hosts, setHosts] = useState<FileHost[]>([]);
  const [pending, setPending] = useState<Record<string, PendingUpload>>({});
  const [over, setOver] = useState(initial.md.length > NOTE_MAX_CHARS);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const gone = useRef(false);
  useEffect(
    () => () => {
      gone.current = true;
    },
    [],
  );
  /** Places the others' carets again; set once the cursors are made, below. */
  const redrawRef = useRef<() => void>(() => undefined);

  // ---- files going up ---------------------------------------------------------
  const queue = useRef<{ id: string; file: File }[]>([]);
  const running = useRef(0);
  const uploads = useRef(new Map<string, { file: File; ctrl: AbortController | null }>());

  const setOne = (id: string, change: Partial<PendingUpload> | null) =>
    setPending((cur) => {
      if (change === null) {
        if (!(id in cur)) return cur;
        const next = { ...cur };
        delete next[id];
        return next;
      }
      const was = cur[id];
      return was ? { ...cur, [id]: { ...was, ...change } } : cur;
    });

  const upload = async (id: string, file: File): Promise<void> => {
    const ctrl = new AbortController();
    const job = uploads.current.get(id);
    if (job) job.ctrl = ctrl;
    try {
      const st = await stage(file);
      const res = await uploadStaged(noteUploads(noteId), st, (p) => setOne(id, { progress: p }), undefined, ctrl.signal);
      if (st.preview) URL.revokeObjectURL(st.preview);
      if (gone.current || ctrl.signal.aborted) return;
      uploads.current.delete(id);
      filesRef.current = { ...filesRef.current, [id]: res.meta };
      setFiles(filesRef.current);
      setOne(id, null);
      session.edit({ files: filesRef.current });
    } catch (err) {
      if (gone.current || ctrl.signal.aborted) return;
      setOne(id, { error: describeError(err, t("notes.file.failed")) });
    }
  };

  const pump = (): void => {
    while (running.current < UPLOADS_AT_ONCE && queue.current.length > 0) {
      const job = queue.current.shift()!;
      running.current += 1;
      void upload(job.id, job.file).finally(() => {
        running.current -= 1;
        pump();
      });
    }
  };

  const addFiles = (list: File[]): void => {
    if (list.length === 0) return;
    const ctl = bench.ctl.current;
    if (!ctl) return;
    const room = NOTE_MAX_FILES - fileIds(ctl.markdown()).length;
    if (room <= 0) {
      toast(t("notes.file.full"), "error");
      return;
    }
    if (list.length > room) toast(t("notes.file.someLeftOut", { count: room }), "info");
    for (const file of list.slice(0, room)) {
      if (!fitsUploadLimit(file.size)) {
        toast(t("notes.file.tooBig", { name: file.name, limit: formatBytes(uploadLimit()) }), "error");
        continue;
      }
      const id = newFileId();
      const name = file.name || t("notes.file.untitled");
      uploads.current.set(id, { file, ctrl: null });
      setPending((cur) => ({ ...cur, [id]: { name, progress: 0, error: null } }));
      bench.run({ t: "file", file: id, name });
      queue.current.push({ id, file });
    }
    pump();
  };

  const retry = (id: string): void => {
    const job = uploads.current.get(id);
    if (!job) return;
    setOne(id, { error: null, progress: 0 });
    queue.current.push({ id, file: job.file });
    pump();
  };

  const removeFile = (host: FileHost): void => {
    const job = uploads.current.get(host.file);
    job?.ctrl?.abort();
    uploads.current.delete(host.file);
    queue.current = queue.current.filter((q) => q.id !== host.file);
    setOne(host.file, null);
    bench.run({ t: "removeBlock", key: host.key });
  };

  useEffect(
    () => () => {
      // leaving the note stops what is still going up; its line says it did not make it
      for (const job of uploads.current.values()) job.ctrl?.abort();
      queue.current = [];
    },
    [],
  );

  const pick = (accept: string): void => {
    const el = fileInput.current;
    if (!el) return;
    el.accept = accept;
    el.click();
  };

  // ---- the writing surface -------------------------------------------------
  const bench = useFormatBench({
    initial: initial.md,
    placeholder: t("notes.editor.placeholder"),
    onSubmit: () => void session.flush(),
    onEscape: () => undefined,
    onMarkdown: (md) => {
      // past the longest a note can be it is not saved, and says so, until it is short enough again
      const tooLong = md.length > NOTE_MAX_CHARS;
      setOver(tooLong);
      if (!tooLong) session.edit({ md });
    },
    read: { files: true, max: NOTE_MAX_CHARS },
    onFiles: setHosts,
    onPasteFiles: (list) => addFiles(list),
    onDraw: () => redrawRef.current(),
    focus: false,
    // first, so they never scroll out of sight along with the rest
    lead: (
      <>
        <ToolButton icon={ImagePlus} label={t("notes.editor.addPicture")} onPress={() => pick("image/*,video/*")} />
        <ToolButton icon={Paperclip} label={t("notes.editor.attachFile")} onPress={() => pick("")} />
      </>
    ),
  });

  // ---- everyone else's caret ------------------------------------------------------
  const cursors = useLiveCursors({ noteId, note, ctl: bench.ctl, page: sheet });
  const { redraw, moved } = cursors;
  redrawRef.current = redraw;
  // the caret or the words moved: the others' carets are placed again, and this one is sent
  useEffect(() => {
    redraw();
    moved();
  }, [bench.state, bench.markdown, files, pending, redraw, moved]);

  // ---- the title -----------------------------------------------------------------
  const changeTitle = (value: string): void => {
    const clean = value.replace(/[\r\n]+/g, " ");
    titleRef.current = clean;
    setTitle(clean);
    onTitle(clean);
    session.edit({ title: clean });
  };
  const titleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // a title is one line: Enter goes on to the note itself
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      bench.ctl.current?.focus();
    }
  };
  // as tall as its words, however many lines they wrap to
  useLayoutEffect(() => {
    const el = titleEl.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const sel = titleSel.current;
    titleSel.current = null;
    if (sel && document.activeElement === el) el.setSelectionRange(Math.min(sel[0], title.length), Math.min(sel[1], title.length));
    redraw();
  }, [title, narrow, redraw]);
  useEffect(() => {
    if (autoFocus === "title") titleEl.current?.focus();
    // only as the note opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- someone else's changes ---------------------------------------------------
  useLayoutEffect(() => {
    bridge.current = {
      onRemote: (doc) => {
        const ctl = bench.ctl.current;
        if (!ctl) return false;
        if (doc.md !== ctl.markdown() && !ctl.reload(doc.md)) return false;
        filesRef.current = doc.files;
        setFiles(doc.files);
        if (doc.title !== titleRef.current) {
          const el = titleEl.current;
          if (el && document.activeElement === el) titleSel.current = [el.selectionStart, el.selectionEnd];
          titleRef.current = doc.title;
          setTitle(doc.title);
          onTitle(doc.title);
        }
        return true;
      },
      read: () => {
        const md = bench.ctl.current?.markdown();
        // a note past its longest is not saved, so what is merged is what was last saved of it
        return md === undefined || md.length > NOTE_MAX_CHARS ? { title: titleRef.current, files: filesRef.current } : { title: titleRef.current, md, files: filesRef.current };
      },
    };
    return () => {
      bridge.current = IDLE_BRIDGE;
    };
  });

  // ---- dropping files on the note ----------------------------------------------
  const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropping) setDropping(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDropping(false);
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  // each file drawn into the frame the surface keeps for it
  const portals = hosts.map((h) => createPortal(<NoteFile meta={files[h.file]} name={h.name} pending={pending[h.file]} onRemove={() => removeFile(h)} onRetry={() => retry(h.file)} />, h.el, String(h.key)));

  return (
    <div className={`${f.frame} ${s.editor}`} data-narrow={narrow || undefined} data-drop={dropping || undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} data-testid="note-editor">
      <div className={s.bar}>
        {barStart}
        {narrow ? <span className={s.barSpace} /> : <div className={s.tools}>{bench.toolbar}</div>}
        <div className={s.barEnd}>{barEnd}</div>
      </div>
      {!narrow && bench.tray ? <div className={s.trayDock}>{bench.tray}</div> : null}
      <div className={s.scroll} data-scroller="">
        <div className={s.sheet} ref={sheet}>
          <textarea
            ref={titleEl}
            className={s.titleInput}
            value={title}
            rows={1}
            maxLength={NOTE_TITLE_MAX}
            placeholder={t("notes.editor.titlePlaceholder")}
            aria-label={t("notes.editor.title")}
            onChange={(e) => changeTitle(e.target.value)}
            onKeyDown={titleKey}
            data-testid="note-title"
          />
          {byline}
          {over ? (
            <p className={s.over} role="alert">
              {t("notes.editor.tooLong", { max: NOTE_MAX_CHARS.toLocaleString() })}
            </p>
          ) : null}
          {bench.simplified ? <p className={s.simplified}>{t("composer.format.simplified")}</p> : null}
          <div ref={bench.surfaceRef} className={`${f.surface} ${s.surface}`} aria-label={t("notes.editor.body")} data-testid="note-surface" />
          {cursors.layer}
        </div>
      </div>
      {narrow ? (
        <>
          {bench.tray}
          {bench.toolbar}
        </>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
        data-testid="note-file-input"
      />
      {portals}
    </div>
  );
}
