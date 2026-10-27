import { PersonName } from "@/components/common/PersonName";
import { AlertTriangle, CloudOff, Eye } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import type { RenderCtx } from "@/markdown/ast";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { NOTE_MAX_CHARS, NOTE_PREVIEW_CHARS, type NoteDoc, type NoteHead } from "@/lib/notes/model";
import { mentionedIds } from "@/lib/notes/mentions";
import { noteError } from "@/lib/notes/errors";
import { personHue } from "@/lib/notes/people";
import type { SaveState } from "@/lib/notes/session";
import { formatRelative } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { peopleHere, useNotes } from "@/stores/notes";
import { displayName, fetchMissingUsers, useUsers } from "@/stores/users";
import { t, Tr } from "@/i18n";
import type { NoteBridge } from "./NoteEditor";
import { NoteFile, NoteFileLine, NoteFileThumb } from "./NoteFile";
import s from "./Notes.module.css";

/** A note's title as it is shown: what it is called, or that it is not called anything yet. */
export function noteName(title: string | undefined | null): string {
  return title?.trim() || t("notes.untitled");
}

/** A clock that moves every half minute, for times said as "2 minutes ago". */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

/** Who wrote in a note last, and when, under its title. */
export function Byline({ noteId }: { noteId: string }) {
  const item = useNotes((n) => n.notes[noteId]);
  const meId = useAuth((a) => a.me?.id);
  const who = useUsers((u) => (item?.editedBy ? u.byId[item.editedBy] : undefined));
  const now = useMinuteClock();
  useEffect(() => {
    if (item?.editedBy && item.editedBy !== meId) fetchMissingUsers([item.editedBy]);
  }, [item?.editedBy, meId]);
  if (!item) return <p className={s.byline} />;
  const when = formatRelative(item.updatedAt, now);
  const me = useAuth.getState().me;
  const face = item.editedBy === meId ? me : who;
  return (
    <p className={s.byline} data-testid="note-byline">
      {item.editedBy && face ? (
        <span className={s.bylineFaces} aria-hidden="true">
          <Avatar id={face.id} avatarId={face.avatar_id ?? null} name={displayName(face)} size={20} />
        </span>
      ) : null}
      <span>{!item.editedBy ? t("notes.page.edited", { when }) : item.editedBy === meId ? t("notes.page.editedByYou", { when }) : <Tr id="notes.page.editedBy" values={{ name: <PersonName userId={item.editedBy}>{displayName(who)}</PersonName>, when }} />}</span>
    </p>
  );
}

/**
 * A note as someone who may only read it sees it: drawn as a message is,
 * files and all, and redrawn as the people writing it save.
 */
export function NoteReader({ initial, bridge, onTitle, barStart, barEnd, byline }: { initial: NoteDoc; bridge: React.MutableRefObject<NoteBridge>; onTitle: (title: string) => void; barStart?: ReactNode; barEnd: ReactNode; byline: ReactNode }) {
  const [doc, setDoc] = useState(initial);
  const base = useRenderCtx();
  const ctx = useMemo<RenderCtx>(() => ({ ...base, renderFile: (id, name, width, align) => <NoteFileLine width={width} align={align}><NoteFile meta={doc.files[id]} name={name} width={width} align={align} /></NoteFileLine> }), [base, doc.files]);
  // the names of the people it mentions, who may be nobody this account has met
  useEffect(() => {
    fetchMissingUsers(mentionedIds(doc.md));
  }, [doc.md]);
  useLayoutEffect(() => {
    bridge.current = {
      onRemote: (next) => {
        setDoc(next);
        onTitle(next.title);
        return true;
      },
    };
    return () => {
      bridge.current = { onRemote: () => false };
    };
  });
  return (
    <div className={s.editor} data-testid="note-reader">
      <div className={s.bar}>
        {barStart}
        <span className={s.viewOnly}>
          <Eye size={15} aria-hidden="true" />
          {t("notes.page.viewOnly")}
        </span>
        <span className={s.barSpace} />
        <div className={s.barEnd}>{barEnd}</div>
      </div>
      <div className={s.scroll} data-scroller="">
        <article className={s.sheet}>
          <h1 className={s.readTitle} data-untitled={doc.title.trim() ? undefined : ""} dir="auto">
            {noteName(doc.title)}
          </h1>
          {byline}
          {doc.md.trim() ? (
            <div className={s.read}>
              <Markdown source={doc.md} ctx={ctx} files max={NOTE_MAX_CHARS} />
            </div>
          ) : (
            <p className={s.readEmpty}>{t("notes.reader.empty")}</p>
          )}
        </article>
      </div>
    </div>
  );
}

/**
 * The first lines of a note, for a share link's card: drawn as the note is,
 * links and all, but as a picture of it, since the whole card is the way in.
 */
export function NotePreview({ head, files }: { head: NoteHead; files: boolean }) {
  const base = useRenderCtx();
  const ctx = useMemo<RenderCtx>(() => ({ ...base, inert: true, renderFile: (id, name) => <NoteFileThumb meta={files ? head.files[id] : undefined} name={name} /> }), [base, head.files, files]);
  return <Markdown source={head.preview} ctx={ctx} files max={NOTE_PREVIEW_CHARS} />;
}

/**
 * Who else has the note open right now: their faces, each ringed in the
 * colour their caret has on the page.
 */
export function PeopleHere({ noteId, max = 4, size = 26 }: { noteId: string; max?: number; size?: number }) {
  const here = useNotes((n) => n.here[noteId]);
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  // someone who stops saying they are here drops off after a while; this is what notices
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, []);
  const ids = peopleHere(here, now).filter((id) => id !== meId);
  const key = ids.join(",");
  useEffect(() => {
    if (key) fetchMissingUsers(key.split(","));
  }, [key]);
  if (ids.length === 0) return null;
  const names = ids.map((id) => displayName(users[id]));
  return (
    <div className={s.here} role="group" aria-label={t("notes.page.hereNow", { names: names.join(", ") })} data-testid="note-here">
      {ids.slice(0, max).map((id, i) => (
        <Tooltip key={id} text={t("notes.page.isHere", { name: names[i]! })}>
          <span className={s.face} style={{ "--who": personHue(noteId, id) } as CSSProperties} tabIndex={0}>
            <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={names[i]!} size={size} />
          </span>
        </Tooltip>
      ))}
      {ids.length > max ? <span className={s.faceMore}>+{ids.length - max}</span> : null}
    </div>
  );
}

/** Where the note stands, in a word: saved, saving, offline, or not saved with the way to try again. */
export function SaveState({ state, error, onRetry, compact }: { state: SaveState; error: unknown; onRetry: () => void; compact?: boolean }) {
  if (state === "failed") {
    const why = noteError(error, t("notes.page.notSavedWhy"));
    return (
      <span className={s.state} data-state="failed" role="alert" data-testid="note-save">
        <Tooltip text={why}>
          <span className={s.stateWord} tabIndex={0}>
            <AlertTriangle size={14} aria-hidden="true" />
            {compact ? null : t("notes.page.notSaved")}
          </span>
        </Tooltip>
        <button type="button" className={s.stateRetry} onClick={onRetry}>
          {t("notes.page.tryAgain")}
        </button>
      </span>
    );
  }
  if (state === "offline") {
    return (
      <Tooltip text={t("notes.page.offlineWhy")}>
        <span className={s.state} data-state="offline" tabIndex={0} data-testid="note-save">
          <CloudOff size={14} aria-hidden="true" />
          {compact ? null : t("notes.page.offline")}
        </span>
      </Tooltip>
    );
  }
  const busy = state === "saving" || state === "unsaved";
  return (
    <span className={s.state} data-state={busy ? "saving" : "saved"} role="status" data-testid="note-save">
      {compact ? <span className={s.stateDot} aria-hidden="true" /> : null}
      <span className={compact ? "visually-hidden" : undefined}>{busy ? t("notes.page.saving") : t("notes.page.saved")}</span>
    </span>
  );
}
