import { NotebookPen, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { NotesList } from "@/components/notes/NotesList";
import { NoteView } from "@/components/notes/NoteView";
import s from "@/components/notes/Notes.module.css";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { noteError } from "@/lib/notes/errors";
import { PERSON_HUES } from "@/lib/notes/people";
import { createNote } from "@/lib/notes/share";
import { useNotes } from "@/stores/notes";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";

/** Narrower than this, the list and a note take turns rather than sitting side by side. */
const SIDE_BY_SIDE = 820;

/**
 * Notes: the list of this account's notes beside the one open, or, where
 * there is room for only one, the list until a note is opened and the note
 * after. The same page for /notes and /notes/:id, so moving between notes
 * leaves the list where it is.
 */
export default function NotesPage() {
  const { noteId = null } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const status = useNotes((n) => n.status);
  const count = useNotes((n) => Object.keys(n.notes).length + n.invites.length);
  const root = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(true);
  const [making, setMaking] = useState(false);
  const fresh = (loc.state as { fresh?: boolean } | null)?.fresh === true;

  useEffect(() => {
    void useNotes.getState().load();
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSplit(el.clientWidth >= SIDE_BY_SIDE);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const make = async () => {
    if (making) return;
    setMaking(true);
    try {
      const made = await createNote();
      nav(`/channels/@me/notes/${made.id}`, { state: { fresh: true } });
    } catch (err) {
      toast(noteError(err, t("notes.list.couldNotCreate")), "error");
    } finally {
      setMaking(false);
    }
  };

  // nothing yet: the page is an invitation to start
  if (status === "ready" && count === 0 && !noteId) {
    return (
      <div className={s.notes} ref={root}>
        <FirstNote onNew={() => void make()} making={making} />
      </div>
    );
  }

  return (
    <div className={s.notes} ref={root} data-split={split || undefined}>
      {split || !noteId ? <NotesList selected={noteId} onNew={() => void make()} making={making} /> : null}
      {split || noteId ? (
        <section className={s.desk} aria-label={t("notes.title")}>
          {noteId ? <NoteView key={noteId} noteId={noteId} narrow={!split} onBack={() => nav("/channels/@me/notes")} fresh={fresh} /> : <NoNoteOpen onNew={() => void make()} making={making} />}
        </section>
      ) : null}
    </div>
  );
}

/** Notes, and none of them open: where to go from here. */
function NoNoteOpen({ onNew, making }: { onNew: () => void; making: boolean }) {
  return (
    <div className={s.calm} data-testid="notes-none-open">
      <p className={s.calmBody}>{t("notes.list.pick")}</p>
      <Button variant="secondary" onClick={onNew} loading={making}>
        <Plus size={16} aria-hidden="true" /> {t("notes.list.new")}
      </Button>
    </div>
  );
}

/**
 * No notes at all: a page being written by two people, as small as a
 * picture, which is what a note here can be, and the way to make the first.
 */
function FirstNote({ onNew, making }: { onNew: () => void; making: boolean }) {
  const rels = useRelationships((r) => r.byUser);
  // a friend's name on the other caret, where there is a friend
  const friend = useMemo(() => Object.values(rels).find((r) => r.type === "friend")?.user, [rels]);
  const name = friend ? friend.display_name || friend.username : t("notes.first.friend");
  return (
    <div className={s.first} data-testid="notes-first">
      <header className={s.firstHead}>
        <PageHeaderButtons />
      </header>
      <div className={s.firstBody}>
        <figure className={s.sample} aria-hidden="true">
          <span className={s.sampleTitle} />
          <span className={s.sampleLine} style={{ width: "92%" }} />
          <span className={s.sampleLine} data-typing="" style={{ "--who": PERSON_HUES[2] } as CSSProperties}>
            <span className={s.sampleCaret}>
              <span className={s.sampleName}>{name}</span>
            </span>
          </span>
          <span className={s.sampleLine} style={{ width: "78%" }} />
          <span className={s.sampleLine} data-mine="" style={{ width: "34%" }}>
            <span className={s.sampleMine} />
          </span>
        </figure>
        <h2 className={s.firstTitle}>{t("notes.first.title")}</h2>
        <p className={s.firstText}>{t("notes.first.body")}</p>
        <Button onClick={onNew} loading={making} data-testid="note-new">
          <NotebookPen size={16} aria-hidden="true" /> {t("notes.list.new")}
        </Button>
      </div>
    </div>
  );
}
