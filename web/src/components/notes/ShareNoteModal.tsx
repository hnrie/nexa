import { personText, personError } from "@/lib/personText";
import { PersonName } from "@/components/common/PersonName";
import { Check, ChevronDown, Copy, KeyRound, Link2, Plus, Trash2, UserPlus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notes as notesApi } from "@/api/notes";
import { users as usersApi } from "@/api/users";
import { NOTE_EDITOR, NOTE_OWNER, NOTE_VIEWER, type NoteLinkRow, type NoteRole, type NoteSharing, type PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { TextInput } from "@/components/common/TextInput";
import { copyText } from "@/lib/copyText";
import { noteError } from "@/lib/notes/errors";
import { createNoteLink, inviteToNote, noteLinkAddress, removeNote } from "@/lib/notes/share";
import { useAuth } from "@/stores/auth";
import { useNotes } from "@/stores/notes";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { noteLinkRoleMenu, noteMemberRoleMenu } from "./noteMenu";
import { displayName, useUsers } from "@/stores/users";
import { t, Tr } from "@/i18n";
import { noteName } from "./NoteParts";
import s from "./Notes.module.css";

function roleName(role: number): string {
  if (role === NOTE_OWNER) return t("notes.share.owner");
  return role === NOTE_EDITOR ? t("notes.share.canEdit") : t("notes.share.canView");
}

/** How many people the search shows at once. */
const SHOWN = 8;

/**
 * Who a note is shared with, and sharing it further. Its owner asks people
 * in, each of whom gets a request to accept, makes links that let anyone who
 * has one join, and changes or takes away what people may do. Everyone else
 * sees who has the note, and can leave it.
 */
export function ShareNoteModal({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const nav = useNavigate();
  const item = useNotes((n) => n.notes[noteId]);
  const changed = useNotes((n) => n.sharing[noteId] ?? 0);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [sharing, setSharing] = useState<NoteSharing | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const owner = item?.role === NOTE_OWNER;

  useEffect(() => {
    let gone = false;
    setFailed(null);
    notesApi.sharing(noteId).then(
      (got) => {
        if (gone) return;
        setSharing(got);
        useUsers.getState().upsert([...got.members.map((m) => m.user), ...got.invites.map((i) => i.user)]);
      },
      (err: unknown) => {
        if (!gone) setFailed(err);
      },
    );
    return () => {
      gone = true;
    };
  }, [noteId, changed, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  // the note went (deleted, or this account taken out of it): nothing left to share
  useEffect(() => {
    if (useNotes.getState().status === "ready" && !item) onClose();
  }, [item, onClose]);

  const title = noteName(item?.head?.title);
  const leave = async () => {
    if (!item) return;
    try {
      await removeNote(item);
      onClose();
      nav("/channels/@me/notes");
    } catch (err) {
      toast(noteError(err), "error");
    }
  };

  return (
    <Modal open onClose={onClose} title={owner ? t("notes.share.title", { title }) : t("notes.share.whoTitle", { title })} width={560} className={s.shareCard}>
      <div className={s.share} data-testid="share-note">
        {failed ? <LoadError message={noteError(failed, t("notes.share.couldNotLoad"))} onRetry={reload} /> : null}
        {!sharing && !failed ? (
          <div className={s.center}>
            <Spinner label={t("notes.share.loading")} />
          </div>
        ) : null}
        {sharing && owner ? <InvitePeople noteId={noteId} sharing={sharing} onDone={reload} /> : null}
        {sharing ? <PeopleWithAccess noteId={noteId} sharing={sharing} owner={owner} meId={meId} onDone={reload} /> : null}
        {sharing && owner ? <ShareLinks noteId={noteId} links={sharing.links} onDone={reload} /> : null}
        {sharing && owner ? (
          <p className={s.keyNote}>
            <KeyRound size={16} aria-hidden="true" />
            <span>{t("notes.share.keyNote")}</span>
          </p>
        ) : null}
        {sharing && !owner && item ? (
          <div className={s.shareFoot}>
            <Button variant="danger" onClick={() => void leave()} data-testid="note-leave">
              {t("notes.menu.leave")}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function InvitePeople({ noteId, sharing, onDone }: { noteId: string; sharing: NoteSharing; onDone: () => void }) {
  const headingId = useId();
  const rels = useRelationships((r) => r.byUser);
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<NoteRole>(NOTE_EDITOR);
  const [found, setFound] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const asked = useRef(0);

  // anyone by their username: the server's search, a moment after the typing stops
  useEffect(() => {
    const query = q.trim().replace(/^@/, "");
    if (query.length < 2) {
      setFound([]);
      return;
    }
    const n = (asked.current += 1);
    const timer = setTimeout(() => {
      usersApi.search(query).then(
        (list) => {
          if (n === asked.current) setFound(list);
        },
        () => undefined,
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const taken = useMemo(() => new Set([...sharing.members.map((m) => m.user.id), ...sharing.invites.map((i) => i.user.id), meId ?? ""]), [sharing, meId]);
  const people = useMemo(() => {
    const query = q.trim().replace(/^@/, "").toLowerCase();
    const friends = Object.values(rels)
      .filter((r) => r.type === "friend")
      .map((r) => r.user)
      .filter((u) => !query || u.username.toLowerCase().includes(query) || (u.display_name ?? "").toLowerCase().includes(query));
    const out: PublicUser[] = [];
    const seen = new Set<string>();
    // friends first, then whoever the search found
    for (const u of [...friends, ...found]) {
      if (seen.has(u.id) || (taken.has(u.id) && !sent.includes(u.id))) continue;
      seen.add(u.id);
      out.push(u);
    }
    return out.slice(0, SHOWN);
  }, [rels, found, q, taken, sent]);

  const invite = async (u: PublicUser) => {
    if (busy) return;
    setBusy(u.id);
    try {
      await inviteToNote(noteId, u, role);
      setSent((list) => [...list, u.id]);
      toast(personText("notes.share.invited", u.id, displayName(u)), "success");
      onDone();
    } catch (err) {
      toast(personError(noteError(err, t("notes.share.couldNotInvite", { name: displayName(u) })), t("notes.share.couldNotInvite", { name: displayName(u) }), personText("notes.share.couldNotInvite", u.id, displayName(u))), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.shareSection} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.shareHeading}>
        {t("notes.share.invitePeople")}
      </h3>
      <div className={s.inviteRow}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("notes.share.searchPlaceholder")} aria-label={t("notes.share.searchPlaceholder")} data-testid="note-invite-search" />
        <div className={s.roles} role="radiogroup" aria-label={t("notes.share.inviteAs")}>
          {[NOTE_EDITOR, NOTE_VIEWER].map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r as NoteRole)} data-testid={`note-invite-role-${r}`}>
              {r === NOTE_EDITOR ? t("notes.share.canEdit") : t("notes.share.canView")}
            </button>
          ))}
        </div>
      </div>
      {people.length > 0 ? (
        <ul className={s.people}>
          {people.map((u) => {
            const name = displayName(u);
            const done = sent.includes(u.id);
            return (
              <li key={u.id} className={s.person} data-testid="note-invite-row" data-user={u.username}>
                <Avatar id={u.id} avatarId={u.avatar_id ?? null} name={name} size={32} />
                <span className={s.personText}>
                  <PersonName user={u} className={s.personName} dir="auto">{name}</PersonName>
                  <span className={s.personUser}>{u.username}</span>
                </span>
                <Button size="sm" variant={done ? "secondary" : "primary"} disabled={done} loading={busy === u.id} onClick={() => void invite(u)} aria-label={done ? t("notes.share.invitedShort") : t("notes.share.inviteNamed", { name })}>
                  {done ? (
                    <>
                      <Check size={14} aria-hidden="true" /> {t("notes.share.invitedShort")}
                    </>
                  ) : (
                    <>
                      <UserPlus size={14} aria-hidden="true" /> {t("notes.share.invite")}
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={s.shareHint}>{q.trim().length >= 2 ? t("notes.share.nobodyFound") : t("notes.share.inviteHint")}</p>
      )}
    </section>
  );
}

function PeopleWithAccess({ noteId, sharing, owner, meId, onDone }: { noteId: string; sharing: NoteSharing; owner: boolean; meId: string | undefined; onDone: () => void }) {
  const headingId = useId();
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, run: () => Promise<void>, fail: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await run();
      onDone();
    } catch (err) {
      toast(noteError(err, fail), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={s.shareSection} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.shareHeading}>
        {t("notes.share.peopleWithAccess")}
      </h3>
      <ul className={s.people} data-testid="note-members">
        {sharing.members.map((m) => {
          const name = displayName(m.user);
          const mine = m.user.id === meId;
          return (
            <li key={m.user.id} className={s.person} data-testid="note-member" data-user={m.user.username}>
              <Avatar id={m.user.id} avatarId={m.user.avatar_id ?? null} name={name} size={32} />
              <span className={s.personText}>
                <span className={s.personName} dir="auto">{mine ? <Tr id="notes.share.you" values={{ name: <PersonName user={m.user}>{name}</PersonName> }} /> : <PersonName user={m.user}>{name}</PersonName>}</span>
                <span className={s.personUser}>{m.user.username}</span>
              </span>
              {owner && m.role !== NOTE_OWNER ? (
                <button
                  type="button"
                  className={s.roleBtn}
                  disabled={busy !== null}
                  aria-haspopup="menu"
                  aria-label={t("notes.share.roleOf", { name })}
                  data-testid="note-member-role"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const setRole = (role: NoteRole) => void act(`role${m.user.id}`, () => notesApi.setRole(noteId, m.user.id, role), t("notes.share.couldNotChange", { name }));
                    noteMemberRoleMenu.open(
                      { role: m.role, setRole, remove: () => void act(`rm${m.user.id}`, () => notesApi.removeMember(noteId, m.user.id), t("notes.share.couldNotRemove", { name })) },
                      { x: r.right, y: r.bottom, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, align: "end" }, label: t("notes.share.roleOf", { name }) },
                    );
                  }}
                >
                  {roleName(m.role)}
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
              ) : (
                <span className={s.roleTag} data-role={m.role}>{roleName(m.role)}</span>
              )}
            </li>
          );
        })}
        {sharing.invites.map((inv) => {
          const name = displayName(inv.user);
          return (
            <li key={inv.id} className={s.person} data-waiting="" data-testid="note-invited" data-user={inv.user.username}>
              <Avatar id={inv.user.id} avatarId={inv.user.avatar_id ?? null} name={name} size={32} />
              <span className={s.personText}>
                <PersonName user={inv.user} className={s.personName} dir="auto">{name}</PersonName>
                <span className={s.personUser}>{t("notes.share.waiting", { role: roleName(inv.role) })}</span>
              </span>
              {owner ? (
                <Button size="sm" variant="ghost" disabled={busy !== null} loading={busy === `inv${inv.id}`} onClick={() => void act(`inv${inv.id}`, () => notesApi.cancelInvite(noteId, inv.id), t("notes.share.couldNotCancel"))}>
                  {t("notes.share.cancelInvite")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ShareLinks({ noteId, links, onDone }: { noteId: string; links: NoteLinkRow[]; onDone: () => void }) {
  const headingId = useId();
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Record<string, string | null>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // each link's address is kept sealed with the note's key, and opened here to be copied again
  const ids = links.map((l) => l.id).join(",");
  useEffect(() => {
    let gone = false;
    void Promise.all(links.map(async (l) => [l.id, await noteLinkAddress(noteId, l)] as const)).then((pairs) => {
      if (!gone) setAddresses(Object.fromEntries(pairs));
    });
    return () => {
      gone = true;
    };
    // the links are what they are by their ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ids]);

  const copy = async (id: string, url: string) => {
    if (!(await copyText(url))) {
      toast(t("common.copyFailed"), "error");
      return;
    }
    setCopied(id);
    setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 2000);
  };

  const create = async (role: NoteRole) => {
    if (busy) return;
    setBusy("new");
    try {
      const made = await createNoteLink(noteId, role);
      setAddresses((cur) => ({ ...cur, [made.row.id]: made.url }));
      if (await copyText(made.url)) {
        setCopied(made.row.id);
        toast(t("notes.share.linkCopied"), "success");
      }
      onDone();
    } catch (err) {
      toast(noteError(err, t("notes.share.couldNotMakeLink")), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await notesApi.removeLink(noteId, id);
      onDone();
    } catch (err) {
      toast(noteError(err, t("notes.share.couldNotRemoveLink")), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.shareSection} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.shareHeading}>
        {t("notes.share.links")}
      </h3>
      {links.length > 0 ? (
        <ul className={s.people} data-testid="note-links">
          {links.map((l) => {
            const url = addresses[l.id];
            return (
              <li key={l.id} className={s.person} data-testid="note-link">
                <span className={s.linkIcon} aria-hidden="true">
                  <Link2 size={18} />
                </span>
                <span className={s.personText}>
                  <span className={s.personName}>{l.role === NOTE_EDITOR ? t("notes.share.linkCanEdit") : t("notes.share.linkCanView")}</span>
                  <span className={s.personUser}>{t("notes.share.linkUses", { count: l.uses })}</span>
                </span>
                {url ? (
                  <Button size="sm" variant={copied === l.id ? "positive" : "secondary"} onClick={() => void copy(l.id, url)} data-testid="note-link-copy">
                    {copied === l.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied === l.id ? t("notes.share.copied") : t("notes.share.copy")}
                  </Button>
                ) : null}
                <button type="button" className={s.rowAct} onClick={() => void remove(l.id)} disabled={busy !== null} aria-label={t("notes.share.removeLink")} title={t("notes.share.removeLink")} data-testid="note-link-remove">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={s.shareHint}>{t("notes.share.linksHint")}</p>
      )}
      <div>
        <Button
          variant="secondary"
          loading={busy === "new"}
          aria-haspopup="menu"
          data-testid="note-link-create"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            noteLinkRoleMenu.open({ create: (role) => void create(role) }, { x: r.left, y: r.bottom, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, align: "start" }, label: t("notes.share.linkRole") });
          }}
        >
          <Plus size={16} aria-hidden="true" /> {t("notes.share.createLink")}
        </Button>
      </div>
    </section>
  );
}
