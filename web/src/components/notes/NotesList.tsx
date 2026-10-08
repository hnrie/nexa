import { Check, Eye, Plus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { NOTE_EDITOR } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { SearchBox } from "@/components/common/SearchBox";
import { Spinner } from "@/components/common/Spinner";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { menuPoint } from "@/components/sidebar/ServerSidebar";
import { parse, plainText, type PlainTextNames } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { mentionedIds } from "@/lib/notes/mentions";
import { noteError } from "@/lib/notes/errors";
import { fileIds, withoutFiles } from "@/lib/notes/model";
import { personHue } from "@/lib/notes/people";
import { acceptNoteInvite, declineNoteInvite } from "@/lib/notes/share";
import { formatListWhen } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { peopleHere, sortedNotes, useNotes, type NoteInviteItem, type NoteItem } from "@/stores/notes";
import { useUI } from "@/stores/ui";
import { displayName, fetchMissingUsers, useUsers } from "@/stores/users";
import { t } from "@/i18n";
import { noteMenu } from "./noteMenu";
import { noteName, useMinuteClock } from "./NoteParts";
import s from "./Notes.module.css";

/** The first words of a note, as plain text, for its row: its words, not the names of its files. */
function firstWords(n: NoteItem, names: PlainTextNames): string {
  if (!n.head) return "";
  const text = withoutFiles(n.head.preview, new Set(fileIds(n.head.preview)));
  // a mention reads as the person's name, as it does in the note
  return plainText(parse(text), names).replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * This account's notes, the one written in last first: each by its title,
 * its first words, when it was last written in and who is in it right now.
 * Above them, the notes people have asked to share.
 */
export function NotesList({ selected, onNew, making }: { selected: string | null; onNew: () => void; making: boolean }) {
  const status = useNotes((n) => n.status);
  const notes = useNotes((n) => n.notes);
  const invites = useNotes((n) => n.invites);
  const [query, setQuery] = useState("");
  const now = useMinuteClock();

  const all = useMemo(() => sortedNotes(notes), [notes]);
  const names = useRenderCtx();
  useEffect(() => {
    fetchMissingUsers(all.flatMap((n) => (n.head ? mentionedIds(n.head.preview) : [])));
  }, [all]);
  const words = useMemo(() => new Map(all.map((n) => [n.id, firstWords(n, names)])), [all, names]);
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return all;
    return all.filter((n) => `${n.head?.title ?? ""}\n${words.get(n.id) ?? ""}`.toLocaleLowerCase().includes(q));
  }, [all, words, query]);

  return (
    <aside className={s.drawer} aria-label={t("notes.title")} data-testid="notes-page">
      <header className={s.drawerHead}>
        <PageHeaderButtons />
        <h1 className={s.drawerTitle}>{t("notes.title")}</h1>
        <button type="button" className={s.newBtn} onClick={onNew} disabled={making} aria-busy={making || undefined} data-testid="note-new">
          <Plus size={16} aria-hidden="true" />
          <span>{t("notes.list.new")}</span>
        </button>
      </header>
      {all.length > 1 ? (
        <div className={s.drawerSearch}>
          <SearchBox value={query} onChange={setQuery} placeholder={t("notes.list.search")} aria-label={t("notes.list.search")} onEscape={() => setQuery("")} data-testid="notes-search" />
        </div>
      ) : null}
      <div className={s.drawerScroll}>
        {invites.length > 0 ? (
          <section className={s.requests} aria-label={t("notes.requests.title")} data-testid="note-requests">
            <h2 className={s.drawerSection}>{t("notes.requests.title")}</h2>
            {invites.map((inv) => (
              <Request key={inv.id} invite={inv} />
            ))}
          </section>
        ) : null}
        {status === "loading" || status === "idle" ? (
          <div className={s.wait}>
            <Spinner label={t("notes.list.loading")} />
          </div>
        ) : null}
        {status === "error" ? <LoadError message={t("notes.list.couldNotLoad")} onRetry={() => void useNotes.getState().load(true)} /> : null}
        {status === "ready" && all.length === 0 ? <p className={s.drawerNote}>{t("notes.list.none")}</p> : null}
        {shown.length > 0 ? (
          <ul className={s.rows} aria-label={t("notes.title")} data-testid="notes-grid">
            {shown.map((n) => (
              <Row key={n.id} note={n} words={words.get(n.id) ?? ""} selected={n.id === selected} now={now} />
            ))}
          </ul>
        ) : status === "ready" && all.length > 0 ? (
          <div className={s.noMatch}>
            <p>{t("notes.list.noMatch", { query: query.trim() })}</p>
            <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
              {t("friends.clearTheSearch")}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function Row({ note, words, selected, now }: { note: NoteItem; words: string; selected: boolean; now: number }) {
  const nav = useNavigate();
  const openModal = useUI((u) => u.openModal);
  const here = useNotes((n) => n.here[note.id]);
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const title = noteName(note.head?.title);
  const live = peopleHere(here, now).filter((id) => id !== meId);
  const menu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    noteMenu.open({ note, nav, openModal, inList: true }, { ...menuPoint(e), label: title });
  };
  const shared = note.members > 1;
  const viewOnly = note.role < NOTE_EDITOR;
  return (
    <li>
      <button
        type="button"
        className={s.row}
        data-selected={selected || undefined}
        aria-current={selected ? "page" : undefined}
        onClick={() => nav(`/channels/@me/notes/${note.id}`)}
        onContextMenu={menu}
        data-testid="note-card"
        data-note={note.id}
      >
        <span className={s.rowTitle} dir="auto" data-untitled={note.head?.title.trim() ? undefined : ""}>
          {title}
        </span>
        <time className={s.rowWhen} dateTime={new Date(note.updatedAt).toISOString()}>
          {formatListWhen(note.updatedAt, now)}
        </time>
        <span className={s.rowWords} dir="auto">
          {note.head ? words || t("notes.card.empty") : t("notes.card.locked")}
        </span>
        {live.length > 0 || shared || viewOnly ? (
          <span className={s.rowMeta}>
            {live.length > 0 ? (
              <span className={s.rowLive} title={t("notes.page.hereNow", { names: live.map((id) => displayName(users[id])).join(", ") })}>
                {live.slice(0, 3).map((id) => (
                  <span key={id} className={s.face} data-small="" style={{ "--who": personHue(note.id, id) } as CSSProperties}>
                    <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={16} />
                  </span>
                ))}
              </span>
            ) : null}
            {shared ? (
              <span className={s.rowShared} title={t("notes.card.sharedWith", { count: note.members })}>
                <Users size={13} aria-hidden="true" />
                <span className="visually-hidden">{t("notes.card.sharedWith", { count: note.members })}</span>
                <span aria-hidden="true">{t("notes.link.people", { count: note.members })}</span>
              </span>
            ) : null}
            {viewOnly ? (
              <span className={s.rowShared}>
                <Eye size={13} aria-hidden="true" />
                {t("notes.page.viewOnly")}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Request({ invite }: { invite: NoteInviteItem }) {
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const from = displayName(invite.from);
  const accept = async () => {
    setBusy("yes");
    try {
      const it = await acceptNoteInvite(invite);
      nav(`/channels/@me/notes/${it.id}`);
    } catch (err) {
      toast(noteError(err, t("notes.requests.couldNotAccept")), "error");
      setBusy(null);
    }
  };
  const decline = async () => {
    setBusy("no");
    try {
      await declineNoteInvite(invite);
    } catch (err) {
      toast(noteError(err, t("notes.requests.couldNotDecline")), "error");
      setBusy(null);
    }
  };
  return (
    <article className={s.request} data-testid="note-request">
      <Avatar id={invite.from.id} avatarId={invite.from.avatar_id ?? null} name={from} size={32} />
      <div className={s.requestText}>
        <p className={s.requestTitle} dir="auto">
          {invite.head ? noteName(invite.head.title) : t("notes.card.locked")}
        </p>
        <p className={s.requestLead}>{invite.role === NOTE_EDITOR ? t("notes.requests.toEdit", { name: from }) : t("notes.requests.toView", { name: from })}</p>
      </div>
      <div className={s.requestActs}>
        <button type="button" className={s.act} data-kind="yes" onClick={() => void accept()} disabled={busy !== null} aria-label={t("notes.requests.accept")} title={t("notes.requests.accept")} data-testid="note-request-accept">
          <Check size={18} aria-hidden="true" />
        </button>
        <button type="button" className={s.act} data-kind="no" onClick={() => void decline()} disabled={busy !== null} aria-label={t("notes.requests.decline")} title={t("notes.requests.decline")} data-testid="note-request-decline">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
