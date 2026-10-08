import { ArrowLeft, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import type { RenderCtx } from "@/markdown/ast";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { noteError } from "@/lib/notes/errors";
import { loadNoteHistory, type NoteHistory as History, type NoteVersionItem } from "@/lib/notes/history";
import { NOTE_MAX_CHARS, type NoteDoc } from "@/lib/notes/model";
import { formatDateDivider, formatExact, formatTime, sameDay } from "@/lib/time";
import { displayName, fetchMissingUsers, useUsers } from "@/stores/users";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { NoteFile, NoteFileLine } from "./NoteFile";
import { noteName } from "./NoteParts";
import s from "./Notes.module.css";

interface Props {
  noteId: string;
  /** The note as it is now on the page. */
  current: () => NoteDoc;
  canRestore: boolean;
  narrow: boolean;
  onClose: () => void;
  /** Puts a version back; false when that could not be done just now. */
  onRestore: (doc: NoteDoc) => Promise<boolean>;
}

const NOW = "now";

/**
 * A note's earlier versions, in place of the note: the version picked, read
 * as it was, on the page, and every version along the side, newest first,
 * by when it was saved and by whom. Whoever may edit the note puts one back
 * from here; what it replaces is kept as a version of its own.
 */
export function NoteHistory({ noteId, current, canRestore, narrow, onClose, onRestore }: Props) {
  const users = useUsers((u) => u.byId);
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(narrow ? null : NOW);
  const [shown, setShown] = useState<{ id: string; doc: NoteDoc } | { id: string; error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => current(), [current]);

  useEffect(() => {
    let gone = false;
    setFailed(null);
    loadNoteHistory(noteId).then(
      (h) => {
        if (gone) return;
        setHistory(h);
        fetchMissingUsers(h.versions.map((v) => v.editedBy).filter((id): id is string => !!id));
      },
      (err: unknown) => {
        if (!gone) setFailed(err);
      },
    );
    return () => {
      gone = true;
    };
  }, [noteId, attempt]);

  useEffect(() => {
    if (!picked) return;
    if (picked === NOW) {
      setShown({ id: NOW, doc: now });
      return;
    }
    if (!history) return;
    let gone = false;
    setShown(null);
    history.open(picked).then(
      (doc) => {
        if (!gone) setShown({ id: picked, doc });
      },
      (error: unknown) => {
        if (!gone) setShown({ id: picked, error });
      },
    );
    return () => {
      gone = true;
    };
  }, [picked, history, now]);

  const version = history?.versions.find((v) => v.id === picked) ?? null;
  const restore = async () => {
    if (!shown || !("doc" in shown) || shown.id === NOW) return;
    setBusy(true);
    try {
      if (await onRestore(shown.doc)) onClose();
      else useUI.getState().toast(t("notes.history.couldNotRestore"), "error");
    } catch (err) {
      useUI.getState().toast(noteError(err, t("notes.history.couldNotRestore")), "error");
    } finally {
      setBusy(false);
    }
  };

  const who = (v: NoteVersionItem): string => (v.editedBy ? displayName(users[v.editedBy]) : t("names.unknownUser"));
  const canPutBack = canRestore && !!shown && "doc" in shown && shown.id !== NOW;

  const rail = (
    <nav className={s.rail} aria-label={t("notes.history.title")} data-testid="note-history-list">
      <button type="button" className={s.version} aria-current={picked === NOW || undefined} onClick={() => setPicked(NOW)}>
        <span className={s.versionWhen}>{t("notes.history.current")}</span>
        <span className={s.versionTitle} dir="auto">{noteName(now.title)}</span>
      </button>
      {history === null && !failed ? (
        <div className={s.wait}>
          <Spinner size={20} label={t("notes.history.loading")} />
        </div>
      ) : null}
      {failed ? <LoadError message={noteError(failed, t("notes.history.couldNotLoad"))} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {history && history.versions.length === 0 ? <p className={s.railNote}>{t("notes.history.none")}</p> : null}
      {history?.versions.map((v, i) => {
        const before = history.versions[i - 1];
        return (
          <Fragment key={v.id}>
            {!before || !sameDay(before.savedAt, v.savedAt) ? <h3 className={s.railDay}>{formatDateDivider(v.savedAt)}</h3> : null}
            <button type="button" className={s.version} aria-current={picked === v.id || undefined} onClick={() => setPicked(v.id)} data-testid="note-version">
              <span className={s.versionWhen}>{formatTime(v.savedAt)}</span>
              <span className={s.versionWho}>
                {v.editedBy ? <Avatar id={v.editedBy} avatarId={users[v.editedBy]?.avatar_id ?? null} name={who(v)} size={18} /> : null}
                {who(v)}
              </span>
              {v.head && v.head.title !== now.title ? (
                <span className={s.versionTitle} dir="auto">
                  {noteName(v.head.title)}
                </span>
              ) : !v.head ? (
                <span className={s.versionTitle}>{t("notes.history.unreadable")}</span>
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );

  const page = (
    <div className={s.scroll} data-scroller="" data-testid="note-history-preview">
      {!shown ? (
        <div className={s.wait}>
          <Spinner size={20} label={t("notes.history.loading")} />
        </div>
      ) : "error" in shown ? (
        <div className={s.sheet}>
          <LoadError message={noteError(shown.error, t("notes.history.couldNotOpen"))} />
        </div>
      ) : (
        <VersionView doc={shown.doc} note={version ? t("notes.history.savedBy", { name: who(version), when: formatExact(version.savedAt) }) : t("notes.history.currentNote")} />
      )}
    </div>
  );

  const back = narrow && picked ? () => setPicked(null) : onClose;
  return (
    <div className={s.editor} data-testid="note-history">
      <div className={s.bar}>
        <button type="button" className={s.back} onClick={back} data-testid="note-history-back">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>{narrow && picked ? t("notes.history.allVersions") : t("notes.history.backToNote")}</span>
        </button>
        <h2 className={s.barTitle}>{t("notes.history.title")}</h2>
        <span className={s.barSpace} />
        {canPutBack ? (
          <Button size="sm" onClick={() => void restore()} loading={busy} data-testid="note-restore">
            <RotateCcw size={15} aria-hidden="true" /> {t("notes.history.restore")}
          </Button>
        ) : null}
      </div>
      <div className={s.historyBody}>
        {narrow ? (picked ? page : rail) : (
          <>
            {page}
            {rail}
          </>
        )}
      </div>
    </div>
  );
}

/** One version of a note, as it read then. */
function VersionView({ doc, note }: { doc: NoteDoc; note: string }) {
  const base = useRenderCtx();
  const ctx = useMemo<RenderCtx>(() => ({ ...base, renderFile: (id, name, width, align) => <NoteFileLine width={width} align={align}><NoteFile meta={doc.files[id]} name={name} width={width} align={align} /></NoteFileLine> }), [base, doc.files]);
  return (
    <article className={s.sheet}>
      <p className={s.versionNote}>{note}</p>
      <h1 className={s.readTitle} dir="auto" data-untitled={doc.title.trim() ? undefined : ""}>
        {noteName(doc.title)}
      </h1>
      {doc.md.trim() ? (
        <div className={s.read}>
          <Markdown source={doc.md} ctx={ctx} files max={NOTE_MAX_CHARS} />
        </div>
      ) : (
        <p className={s.readEmpty}>{t("notes.reader.empty")}</p>
      )}
    </article>
  );
}
