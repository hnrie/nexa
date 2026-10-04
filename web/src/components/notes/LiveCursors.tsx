import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { CursorMark, FormatSurface } from "@/components/composer/format/surface";
import { b64url, openNoteCursor, sealNoteCursor } from "@/crypto/notes";
import { randomBytes } from "@/crypto/bytes";
import { gateway } from "@/gateway/session";
import { readCursor, sameMark } from "@/lib/notes/cursors";
import type { OpenNote } from "@/lib/notes/open";
import { personHue } from "@/lib/notes/people";
import { useAuth } from "@/stores/auth";
import { peopleHere, useNotes, watchNote } from "@/stores/notes";
import { displayName, useUsers } from "@/stores/users";
import s from "./Notes.module.css";

/** How often this page's caret is sent at most while it moves. */
const SEND_EVERY = 150;

interface Remote {
  userId: string;
  /** The page it came from. */
  page: string;
  mark: CursorMark;
  /** When it last moved, which is when its name shows. */
  moved: number;
}

interface Drawn {
  key: string;
  hue: string;
  name: string;
  moved: number;
  caret: { left: number; top: number; height: number } | null;
  boxes: { left: number; top: number; width: number; height: number }[];
}

interface Options {
  noteId: string;
  note: OpenNote;
  ctl: React.MutableRefObject<FormatSurface | null>;
  /** What the carets are drawn over; their layer is placed inside it. */
  page: RefObject<HTMLElement | null>;
}

export interface LiveCursors {
  /** The layer the others' carets and selections are drawn in. */
  layer: ReactNode;
  /** This page's selection or text changed: its caret is sent, a moment later. */
  moved: () => void;
  /** The page was drawn again: the others' carets are placed again. */
  redraw: () => void;
}

/**
 * Everyone else's caret and selection in a note, as they move, and this
 * page's sent to them: the way a note written together shows who is writing
 * where. A caret is a line in its person's colour with their name over it
 * while it moves; a selection is a wash of the same colour. Positions go
 * sealed with the note's key, through the gateway, only while someone else
 * has the note open.
 */
export function useLiveCursors({ noteId, note, ctl, page }: Options): LiveCursors {
  const meId = useAuth((a) => a.me?.id);
  const here = useNotes((n) => n.here[noteId]);
  const users = useUsers((u) => u.byId);
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  /**
   * Each person's caret, from whichever of their pages moved it last: a page
   * that closed without saying so (a tab closed, an app taken off the screen)
   * leaves no caret behind once the person's page in its place moves.
   */
  const remote = useRef(new Map<string, Remote>());
  const frame = useRef(0);
  /** This page, among its person's other pages with the note open. */
  const sid = useRef(b64url.enc(randomBytes(9)));
  const sent = useRef<CursorMark | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSend = useRef(0);
  const names = useRef(users);
  names.current = users;
  const others = peopleHere(here).filter((id) => id !== meId);
  const anyone = useRef(false);
  anyone.current = others.length > 0;

  const redraw = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const c = ctl.current;
      const box = page.current?.getBoundingClientRect();
      if (!c || !box) return;
      const out: Drawn[] = [];
      for (const [key, r] of remote.current) {
        const at = c.cursorRects(r.mark);
        out.push({
          key,
          hue: personHue(noteId, r.userId),
          name: displayName(names.current[r.userId]),
          moved: r.moved,
          caret: at.caret ? { left: at.caret.left - box.left, top: at.caret.top - box.top, height: at.caret.height } : null,
          boxes: at.boxes.map((b) => ({ left: b.left - box.left, top: b.top - box.top, width: b.width, height: b.height })),
        });
      }
      setDrawn(out);
    });
  }, [ctl, page, noteId]);

  const send = useCallback(
    async (always = false) => {
      const c = ctl.current;
      if (!c || !anyone.current) return;
      const mark = c.cursor();
      if (!always && sameMark(mark, sent.current)) return;
      sent.current = mark;
      lastSend.current = Date.now();
      try {
        gateway()?.sendNoteCursor(noteId, await sealNoteCursor(note.key(), { s: sid.current, ...mark }));
      } catch {
        // a key that changed under it: the next move sends it again
        sent.current = null;
      }
    },
    [ctl, noteId, note],
  );

  const moved = useCallback(() => {
    if (timer.current || !anyone.current) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        void send();
      },
      Math.max(0, lastSend.current + SEND_EVERY - Date.now()),
    );
  }, [send]);

  // what the others send
  useEffect(
    () =>
      watchNote(noteId, {
        cursor: (d) => {
          void openNoteCursor(note.key(), d.data).then(
            (raw) => {
              const msg = readCursor(raw);
              if (!msg) return;
              // this person's own other pages are not drawn as somebody else
              if (d.user_id === useAuth.getState().me?.id) return;
              if ("gone" in msg) {
                if (remote.current.get(d.user_id)?.page === msg.s) remote.current.delete(d.user_id);
              } else remote.current.set(d.user_id, { userId: d.user_id, page: msg.s, mark: { a: msg.a, f: msg.f }, moved: Date.now() });
              redraw();
            },
            () => undefined,
          );
        },
        presence: (d) => {
          if (!d.here) {
            remote.current.delete(d.user_id);
            redraw();
          } else if (d.hello) {
            // someone has just opened the note: they see where this caret is at once
            anyone.current = true;
            void send(true);
          }
        },
      }),
    [noteId, note, redraw, send],
  );

  // whoever is no longer here takes their caret with them
  const hereKey = others.join(",");
  useEffect(() => {
    const still = new Set(hereKey ? hereKey.split(",") : []);
    let gone = false;
    for (const [key, r] of remote.current) {
      if (!still.has(r.userId)) {
        remote.current.delete(key);
        gone = true;
      }
    }
    if (gone) redraw();
    // and whoever has just come sees this one
    if (still.size > 0) void send(true);
  }, [hereKey, redraw, send]);

  // names fade a moment after their caret stops; a page drawn at a new size places every caret again
  useEffect(() => {
    const el = page.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    window.addEventListener("resize", redraw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, [page, redraw]);

  // leaving the note says so, so the others' copies drop this caret at once
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (frame.current) cancelAnimationFrame(frame.current);
      if (!anyone.current) return;
      void sealNoteCursor(note.key(), { s: sid.current, gone: true })
        .then((data) => gateway()?.sendNoteCursor(noteId, data))
        .catch(() => undefined);
    },
    [noteId, note],
  );

  const layer = (
    <div className={s.cursors} aria-hidden="true" data-testid="note-cursors">
      {drawn.map((d) => (
        <Fragment key={d.key}>
          {d.boxes.map((b, i) => (
            <span key={i} className={s.theirPick} style={{ left: b.left, top: b.top, width: b.width, height: b.height, "--who": d.hue } as CSSProperties} />
          ))}
          {d.caret ? (
            <span className={s.theirCaret} style={{ left: d.caret.left, top: d.caret.top, height: d.caret.height, "--who": d.hue } as CSSProperties} data-testid="note-their-caret">
              <span key={d.moved} className={s.theirName}>
                {d.name}
              </span>
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );

  return { layer, moved, redraw };
}
