import { ArrowLeft, History, MoreHorizontal, NotebookPen, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { NOTE_EDITOR, NOTE_OWNER } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Tooltip } from "@/components/common/Tooltip";
import { noteError } from "@/lib/notes/errors";
import type { NoteDoc } from "@/lib/notes/model";
import { openNoteSession, type OpenNote } from "@/lib/notes/open";
import type { SaveState as Saving } from "@/lib/notes/session";
import { useKeys } from "@/stores/keys";
import { useNotes } from "@/stores/notes";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { IDLE_BRIDGE, NoteEditor, type NoteBridge } from "./NoteEditor";
import { NoteHistory } from "./NoteHistory";
import { noteMenuItems } from "./noteMenu";
import { Byline, NoteReader, PeopleHere, SaveState, noteName } from "./NoteParts";
import s from "./Notes.module.css";

type Opening = { kind: "opening" } | { kind: "open"; note: OpenNote } | { kind: "gone" } | { kind: "failed"; error: unknown };

interface Props {
  noteId: string;
  /** One column at a time (a phone, a narrow window): the bar has the way back to the list. */
  narrow: boolean;
  onBack: () => void;
  /** A note just made: the caret starts in its title. */
  fresh: boolean;
}

/**
 * One note, open: written in by whoever may edit it, with everyone else who
 * has it open seeing the words and the carets move, or read by whoever may
 * only read it, kept up to date the same way. Its history opens in its place.
 */
export function NoteView({ noteId, narrow, onBack, fresh }: Props) {
  const nav = useNavigate();
  const keysOpen = useKeys((k) => k.identity !== null);
  const item = useNotes((n) => n.notes[noteId]);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const [opening, setOpening] = useState<Opening>({ kind: "opening" });
  const [save, setSave] = useState<{ state: Saving; error: unknown }>({ state: "saved", error: null });
  const [, setTitle] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bridge = useRef<NoteBridge>(IDLE_BRIDGE);

  useEffect(() => {
    if (!keysOpen || !noteId) return;
    let cancelled = false;
    let handle: OpenNote | null = null;
    setOpening({ kind: "opening" });
    setSave({ state: "saved", error: null });
    setHistory(false);
    openNoteSession(noteId, {
      onState: (state, error) => setSave({ state, error }),
      onRemote: (doc, at) => bridge.current.onRemote(doc, at),
      read: () => bridge.current.read?.() ?? {},
      canShow: () => bridge.current.canShow?.() ?? true,
      caret: () => bridge.current.caret?.() ?? { md: null, title: null },
      onGone: () => setOpening({ kind: "gone" }),
    }).then(
      (h) => {
        if (cancelled) {
          h.close();
          return;
        }
        handle = h;
        setOpening({ kind: "open", note: h });
      },
      (error: unknown) => {
        if (cancelled) return;
        setOpening(error instanceof ApiError && error.status === 404 ? { kind: "gone" } : { kind: "failed", error });
      },
    );
    return () => {
      cancelled = true;
      handle?.close();
    };
  }, [noteId, keysOpen, attempt]);

  const role = item?.role ?? 0;
  const editable = role >= NOTE_EDITOR;
  const owner = role === NOTE_OWNER;
  const back = narrow ? (
    <Tooltip text={t("notes.page.backToNotes")}>
      <button type="button" className={s.iconBtn} onClick={onBack} aria-label={t("notes.page.backToNotes")} data-testid="note-back">
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
    </Tooltip>
  ) : null;

  if (opening.kind !== "open") {
    return (
      <div className={s.editor}>
        <div className={s.bar}>
          {back}
          <span className={s.barSpace} />
        </div>
        {opening.kind === "opening" ? (
          <div className={s.calm}>
            <Spinner label={t("notes.page.opening")} />
          </div>
        ) : opening.kind === "gone" ? (
          <div className={s.calm} data-testid="note-gone">
            <NotebookPen size={28} className={s.calmIcon} aria-hidden="true" />
            <h2 className={s.calmTitle}>{t("notes.page.goneTitle")}</h2>
            <p className={s.calmBody}>{t("notes.page.goneBody")}</p>
            <Button variant="secondary" onClick={() => nav("/channels/@me/notes")}>
              {t("notes.page.backToNotes")}
            </Button>
          </div>
        ) : (
          <div className={s.calm} role="alert">
            <h2 className={s.calmTitle}>{t("notes.page.failedTitle")}</h2>
            <p className={s.calmBody}>{noteError(opening.error, t("notes.page.failedBody"))}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>{t("notes.page.tryAgain")}</Button>
          </div>
        )}
      </div>
    );
  }

  const note = opening.note;
  if (history) {
    return (
      <NoteHistory
        noteId={noteId}
        current={() => note.session.doc}
        canRestore={editable}
        narrow={narrow}
        onClose={() => setHistory(false)}
        onRestore={async (doc: NoteDoc) => {
          const done = await note.session.restore(doc);
          if (done) useUI.getState().toast(t("notes.history.restored"), "success");
          return done;
        }}
      />
    );
  }

  const title = noteName(note.session.doc.title);
  const more = (e: MouseEvent<HTMLButtonElement>) => {
    if (!item) return;
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: r.right,
      y: r.bottom,
      anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, align: "end" },
      label: title,
      items: noteMenuItems(item, { nav, openModal, onHistory: () => setHistory(true), onGone: () => nav("/channels/@me/notes") }),
    });
  };
  const barEnd = (
    <>
      <PeopleHere noteId={noteId} max={narrow ? 2 : 4} />
      {editable ? <SaveState state={save.state} error={save.error} onRetry={() => void note.session.retry()} compact={narrow} /> : null}
      {narrow ? null : (
        <Tooltip text={t("notes.menu.history")}>
          <button type="button" className={s.iconBtn} onClick={() => setHistory(true)} aria-label={t("notes.menu.history")} data-testid="note-history">
            <History size={19} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      {item && owner ? (
        <button type="button" className={s.shareBtn} onClick={() => openModal("shareNote", { noteId })} data-testid="note-share" aria-label={narrow ? t("notes.menu.share") : undefined}>
          <UserPlus size={16} aria-hidden="true" />
          {narrow ? null : <span>{t("notes.menu.share")}</span>}
        </button>
      ) : item ? (
        <Tooltip text={t("notes.menu.whoHasAccess")}>
          <button type="button" className={s.iconBtn} onClick={() => openModal("shareNote", { noteId })} aria-label={t("notes.menu.whoHasAccess")} data-testid="note-share">
            <Users size={19} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      {item ? (
        <Tooltip text={t("notes.page.more")}>
          <button type="button" className={s.iconBtn} onClick={more} aria-label={t("notes.page.more")} aria-haspopup="menu" data-testid="note-more">
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </>
  );
  const byline = <Byline noteId={noteId} />;

  // What is being written stays in the note when the view changes: a role
  // taken away mid-sentence leaves the reader with the note as it was saved.
  return editable ? (
    <NoteEditor key="edit" noteId={noteId} note={note} initial={note.session.doc} bridge={bridge} onTitle={setTitle} autoFocus={fresh && !note.session.doc.title && !note.session.doc.md ? "title" : null} barStart={back} barEnd={barEnd} byline={byline} />
  ) : (
    <NoteReader key="read" initial={note.session.doc} bridge={bridge} onTitle={setTitle} barStart={back} barEnd={barEnd} byline={byline} />
  );
}
