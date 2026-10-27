import { PersonName } from "@/components/common/PersonName";
import { KeyRound, NotebookPen, RotateCw, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { NOTE_EDITOR } from "@/api/types";
import { Button } from "@/components/common/Button";
import type { NoteLinkSecret } from "@/crypto/notes";
import type { RenderCtx } from "@/markdown/ast";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { noteError } from "@/lib/notes/errors";
import { loadNoteLinkPreview, useNoteLinkPreview } from "@/lib/notes/linkPreview";
import { NOTE_PREVIEW_CHARS } from "@/lib/notes/model";
import { joinNoteLink } from "@/lib/notes/share";
import { useUI } from "@/stores/ui";
import { displayName } from "@/stores/users";
import { t, Tr } from "@/i18n";
import { NoteFileThumb } from "./NoteFile";
import { noteName } from "./NoteParts";
import s from "./Notes.module.css";

/** The two halves of a share link, from its token and the fragment it came with; null when the key is missing. */
export function linkSecret(token: string, hash: string): NoteLinkSecret | null {
  const key = hash.startsWith("#") ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{43}$/.test(key) ? { token, key } : null;
}

interface Props {
  secret: NoteLinkSecret | null;
  variant: "card" | "dialog" | "page";
  /** After the note is opened or joined: a dialog closes. */
  onDone?: () => void;
  /** In place of Join for someone not signed in: the way to sign in. */
  actions?: ReactNode;
}

/**
 * What a note's share link leads to: the note's title and first lines, who
 * shares it and with how many, what joining lets you do, and the button to
 * join it or open it. Drawn as a card in a message, in the dialog a link
 * opens and on the page a visitor lands on.
 */
export function NoteLinkView({ secret, variant, onDone, actions }: Props) {
  const nav = useNavigate();
  const entry = useNoteLinkPreview(secret);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = useRenderCtx();
  const opened = entry?.status === "ready" ? entry.opened : null;
  // A note's files can be fetched only by the people in it: anyone else is
  // shown their names. The card is a picture of the note, and nothing in it
  // takes a click of its own.
  const files = opened && opened.view.member_role > 0 ? opened.head.files : null;
  const ctx = useMemo<RenderCtx>(() => ({ ...base, inert: true, renderFile: (id, name) => <NoteFileThumb meta={files?.[id]} name={name} /> }), [base, files]);

  if (!secret || entry?.status === "locked") {
    return (
      <Gone variant={variant} title={t("notes.link.noKeyTitle")} body={t("notes.link.noKeyBody")} icon={<KeyRound size={22} aria-hidden="true" />} />
    );
  }
  if (entry?.status === "invalid") return <Gone variant={variant} title={t("notes.link.goneTitle")} body={t("notes.link.goneBody")} />;
  if (entry?.status === "failed") {
    return (
      <Gone variant={variant} title={t("notes.link.failedTitle")} body={t("notes.link.failedBody")}>
        <Button size="sm" variant="secondary" onClick={() => void loadNoteLinkPreview(secret, { force: true })}>
          <RotateCw size={14} aria-hidden="true" /> {t("notes.link.tryAgain")}
        </Button>
      </Gone>
    );
  }
  if (!opened) {
    return (
      <div className={s.linkView} data-variant={variant} data-state="loading" data-testid="note-link-card" aria-busy="true">
        <div className={s.linkTop}>
          <span className={s.linkGlyph} aria-hidden="true">
            <NotebookPen size={variant === "card" ? 20 : 26} />
          </span>
          <div className={s.linkMain}>
            <span className={s.skeletonLine} />
            <span className={s.skeletonLine} data-short="" />
          </div>
        </div>
      </div>
    );
  }

  const { view, head } = opened;
  const member = view.member_role > 0;
  const owner = view.owner ? displayName(view.owner) : null;
  const open = () => {
    onDone?.();
    nav(`/channels/@me/notes/${view.note_id}`);
  };
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const it = await joinNoteLink(secret, opened);
      onDone?.();
      nav(`/channels/@me/notes/${it.id}`);
    } catch (err) {
      const said = noteError(err, t("notes.link.couldNotJoin"));
      if (variant === "card") useUI.getState().toast(said, "error");
      else setError(said);
    } finally {
      setBusy(false);
    }
  };
  const button = actions ?? (member ? (
    <Button size={variant === "card" ? "sm" : "lg"} block={variant !== "card"} variant="secondary" onClick={open} data-testid="note-link-open">
      {t("notes.link.open")}
    </Button>
  ) : (
    <Button size={variant === "card" ? "sm" : "lg"} block={variant !== "card"} variant="positive" loading={busy} onClick={() => void join()} data-testid="note-link-join">
      {t("notes.link.join")}
    </Button>
  ));

  return (
    <div className={s.linkView} data-variant={variant} data-state="ready" data-testid="note-link-card" role="group" aria-label={t("notes.link.label", { title: noteName(head.title) })}>
      <div className={s.linkTop}>
        <span className={s.linkGlyph} aria-hidden="true">
          <NotebookPen size={variant === "card" ? 20 : 26} />
        </span>
        <div className={s.linkMain}>
          <p className={s.linkLead}>{owner ? <Tr id="notes.link.sharedBy" values={{ name: <PersonName user={view.owner}>{owner}</PersonName> }} /> : t("notes.link.shared")}</p>
          <p className={s.linkTitle} dir="auto" data-untitled={head.title.trim() ? undefined : ""}>
            {noteName(head.title)}
          </p>
        </div>
        {variant === "card" ? <div className={s.linkCardAct}>{button}</div> : null}
      </div>
      {head.preview.trim() ? (
        <div className={s.linkPreview} aria-hidden="true">
          <Markdown source={head.preview} ctx={ctx} files max={NOTE_PREVIEW_CHARS} />
        </div>
      ) : null}
      <div className={s.linkMeta}>
        <span className={s.linkCount}>
          <Users size={14} aria-hidden="true" />
          {t("notes.link.people", { count: view.members })}
        </span>
        <span className={s.roleTag} data-role={member ? view.member_role : view.role}>
          {member ? t("notes.link.alreadyIn") : view.role === NOTE_EDITOR ? t("notes.link.joinToEdit") : t("notes.link.joinToView")}
        </span>
      </div>
      {variant !== "card" ? (
        <div className={s.linkActs}>
          {button}
          {error ? (
            <p className={s.linkError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Gone({ variant, title, body, icon, children }: { variant: Props["variant"]; title: string; body: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.linkView} data-variant={variant} data-state="gone" data-testid="note-link-card" role="group" aria-label={title}>
      <div className={s.linkTop}>
        <span className={s.linkGlyph} data-gone="" aria-hidden="true">
          {icon ?? <NotebookPen size={variant === "card" ? 20 : 26} />}
        </span>
        <div className={s.linkMain}>
          <p className={s.linkTitle}>{title}</p>
          <p className={s.linkLead}>{body}</p>
        </div>
        {children ? <div className={s.linkCardAct}>{children}</div> : null}
      </div>
    </div>
  );
}
