import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { notes as notesApi } from "@/api/notes";
import type { PublicUser } from "@/api/types";
import { Autocomplete, type AcItem } from "@/components/composer/Autocomplete";
import type { Bench } from "@/components/composer/format/FormatEditor";
import { t } from "@/i18n";
import { mentionMatches, mentionedIds } from "@/lib/notes/mentions";
import { useNotes } from "@/stores/notes";
import { fetchMissingUsers, useUsers } from "@/stores/users";

/** How wide the list is, and how far it keeps from the edges of the window. */
const WIDTH = 320;
const EDGE = 8;
/** How much room the list wants under the caret before it opens above it instead. */
const ROOM = 300;

interface Open {
  query: string;
  box: { left: number; top: number; height: number };
}

/**
 * Mentioning people while writing a note: typing @ offers the people who
 * have the note, narrowed by what is typed after it, in the list the message
 * box uses, hung from the caret. Arrow keys move through it, Enter or Tab puts
 * the person in, Escape puts it away until the next @. Also fetches the
 * profiles of everyone the note already mentions, so their names show.
 */
export function useNoteMentions(noteId: string, bench: Bench, meId: string | null): ReactNode {
  // who has the note, asked for again whenever that changes
  const [people, setPeople] = useState<PublicUser[]>([]);
  const changes = useNotes((n) => n.sharing[noteId] ?? 0);
  useEffect(() => {
    let live = true;
    notesApi.sharing(noteId).then(
      (sh) => {
        if (!live) return;
        const users = sh.members.map((m) => m.user);
        useUsers.getState().upsert(users);
        setPeople(users);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [noteId, changes]);

  // names for everyone already mentioned, people who have since left the note included
  useEffect(() => {
    fetchMissingUsers(mentionedIds(bench.markdown));
  }, [bench.markdown]);

  const [open, setOpen] = useState<Open | null>(null);
  const [index, setIndex] = useState(0);
  /** The query Escape put away, so the list stays shut until the @ is a new one. */
  const shut = useRef<string | null>(null);

  const look = (): void => {
    const at = bench.ctl.current?.mentionAt() ?? null;
    if (!at) {
      shut.current = null;
      setOpen(null);
      return;
    }
    if (shut.current !== null && at.query.startsWith(shut.current)) {
      setOpen(null);
      return;
    }
    shut.current = null;
    setOpen((cur) => {
      if (cur?.query !== at.query) setIndex(0);
      return at;
    });
  };
  // the caret moved or the words changed
  useLayoutEffect(look, [bench.state, bench.markdown]);
  // the note scrolled or the window changed size: the list follows the caret
  useEffect(() => {
    if (!open) return;
    const again = () => look();
    window.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    return () => {
      window.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
    };
  });

  const found = useMemo(() => (open ? mentionMatches(people.filter((u) => u.id !== meId), open.query) : []), [open, people, meId]);
  const items: AcItem[] = found.map((user) => ({ kind: "user", user }));

  const pick = (i: number): void => {
    const u = found[i];
    if (!u || !open) return;
    bench.run({ t: "mention", raw: `<@${u.id}>`, label: "@" + (u.display_name || u.username), replace: open.query.length + 1 });
    setOpen(null);
  };

  // the list's keys come before the surface's own: Enter puts the person in rather than starting a line
  const latest = useRef({ open, found, index, pick });
  latest.current = { open, found, index, pick };
  useEffect(() => {
    const el = bench.surfaceRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const cur = latest.current;
      if (!cur.open || cur.found.length === 0 || e.isComposing) return;
      const n = cur.found.length;
      if (e.key === "ArrowDown") setIndex((cur.index + 1) % n);
      else if (e.key === "ArrowUp") setIndex((cur.index - 1 + n) % n);
      else if ((e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) || (e.key === "Tab" && !e.shiftKey)) cur.pick(cur.index);
      else if (e.key === "Escape") {
        shut.current = cur.open.query;
        setOpen(null);
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    el.addEventListener("keydown", onKey, true);
    return () => el.removeEventListener("keydown", onKey, true);
  }, [bench.surfaceRef]);

  if (!open || items.length === 0) return null;
  const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(open.box.left - 12, window.innerWidth - width - EDGE));
  const below = open.box.top + open.box.height + ROOM <= window.innerHeight;
  // in place of where the message box's list sits: hung from the caret, under its line or over it
  const style: CSSProperties = {
    position: "fixed",
    insetInline: "auto",
    left,
    width,
    margin: 0,
    zIndex: 60,
    maxHeight: Math.min(ROOM, window.innerHeight - EDGE * 2),
    ...(below ? { top: open.box.top + open.box.height + 6, bottom: "auto" } : { bottom: window.innerHeight - open.box.top + 6, top: "auto" }),
  };
  return createPortal(<Autocomplete kind="user" items={items} index={Math.min(index, items.length - 1)} onHover={setIndex} onPick={pick} tone={0} heading={t("notes.share.peopleWithAccess")} style={style} />, document.body);
}
