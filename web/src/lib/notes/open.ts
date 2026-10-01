import { ApiError } from "@/api/client";
import { notes as notesApi } from "@/api/notes";
import type { NoteRow } from "@/api/types";
import { DecryptError } from "@/crypto/keys";
import { openNote, sealNote } from "@/crypto/notes";
import { holdReload } from "@/lib/busy";
import { useKeys } from "@/stores/keys";
import { refreshNote, useNotes, watchNote } from "@/stores/notes";
import { noteKeyOf } from "./keys";
import { merge3 } from "./merge";
import { readBody, readHead, withoutFiles, type NoteDoc } from "./model";
import { NoteSession, type SaveState, type SessionEvents } from "./session";
import { keepUnsent, takeUnsent } from "./unsent";

/**
 * A note open on the page: its session (session.ts) joined to the server,
 * the note's key and the gateway.
 *
 * What others save arrives as events and goes into the session, which puts
 * it together with what is typed here. The note's key can change under an
 * open note (its owner's app gives it a new one when someone leaves): a
 * sealed part that will not open with the key held is tried again with the
 * key the server has for this account now. And everyone with the note open
 * says so every little while, which is all "who is here" is.
 */

/** What kind of failure a save or a fetch met. */
export function failureKind(err: unknown): "stale" | "offline" | "other" {
  if (!(err instanceof ApiError)) return "other";
  if (err.code === "note_stale") return "stale";
  // no answer, the server restarting, or being asked to slow down: the words are kept here and sent again
  if (err.status === 0 || err.status === 429 || err.status >= 500) return "offline";
  return "other";
}

/**
 * A save refused over files the server would not take (somebody took them
 * out of the note while this page still showed them): the note without them.
 */
export function withoutRefusedFiles(err: unknown, doc: NoteDoc): NoteDoc | null {
  if (!(err instanceof ApiError) || err.code !== "note_file") return null;
  const named = err.details?.["files"];
  if (!Array.isArray(named) || named.length === 0) return null;
  const refused = new Set(named.map(String));
  const files = { ...doc.files };
  const gone = new Set<string>();
  let changed = false;
  for (const [id, meta] of Object.entries(doc.files)) {
    if (refused.has(meta.blob_id)) {
      gone.add(id);
      delete files[id];
      changed = true;
    } else if (meta.preview && refused.has(meta.preview.blob_id)) {
      // only its small copy: the picture stays, shown at its full size
      const { preview: _preview, ...rest } = meta;
      files[id] = rest;
      changed = true;
    }
  }
  return changed ? { ...doc, md: withoutFiles(doc.md, gone), files } : null;
}

/** How often an open note says it is open, and how soon a hello is answered again. */
const HERE_EVERY = 20_000;
const HELLO_GAP = 2500;
/** The longest sealed note a save may carry while the page is going away: a request that outlives its page is limited to 64 KiB. */
const KEEPALIVE_MAX = 56_000;

export interface OpenNoteEvents extends SessionEvents {
  /** The note is gone for this account: deleted, or this account is no longer in it. */
  onGone: () => void;
}

export interface OpenNote {
  id: string;
  session: NoteSession;
  /** The note's key as it is now, for what is sealed beside the note (a share link). */
  key: () => Uint8Array;
  /** Stops following the note. What is unsaved is sent first. */
  close: () => void;
}

/** Opens a note for the page: fetched, unsealed, and followed until closed. */
export async function openNoteSession(id: string, events: OpenNoteEvents): Promise<OpenNote> {
  const first = await refreshNote(id);
  let key = first.key;
  let closed = false;
  /** While the page is going away, a save is sent so that it outlives the page. */
  let leaving = false;

  const fetchRow = async (): Promise<NoteRow> => {
    const row = await notesApi.get(id);
    key = await noteKeyOf(row);
    void useNotes.getState().put(row);
    return row;
  };
  const open = async (part: "head" | "body", sealed: string): Promise<unknown> => {
    const used = key;
    try {
      return await openNote(used, part, sealed);
    } catch (err) {
      if (!(err instanceof DecryptError)) throw err;
      // sealed with a key newer than the one held: asked for, and tried once more
      if (key === used) await fetchRow();
      if (key === used) throw err;
      return openNote(key, part, sealed);
    }
  };

  const [head, body] = await Promise.all([open("head", first.row.head), open("body", first.row.body ?? "")]);
  const h = readHead(head);
  const b = readBody(body);
  const doc: NoteDoc = { title: h.title, md: b.md, files: b.files };

  // a new version of the app waits for a note that is still being saved
  let release: (() => void) | null = null;
  const hold = (state: SaveState): void => {
    const busy = state === "unsaved" || state === "saving";
    if (busy && !release) release = holdReload("send");
    else if (!busy && release) {
      release();
      release = null;
    }
  };

  const session = new NoteSession(
    {
      save: async (sealedHead, sealedBody, base, files, keep) => {
        const res = await notesApi.save(id, sealedHead, sealedBody, base, files, { keep, keepalive: leaving && sealedHead.length + sealedBody.length < KEEPALIVE_MAX });
        return { version: res.version };
      },
      fetch: async () => {
        const row = await fetchRow();
        return { version: row.version, head: row.head, body: row.body ?? "" };
      },
      seal: (part, value) => sealNote(key, part, value),
      open,
      kind: failureKind,
      mend: withoutRefusedFiles,
    },
    { version: first.row.version, doc },
    {
      ...events,
      onState: (state, error) => {
        hold(state);
        events.onState(state, error);
      },
    },
  );

  // Words written here that never reached the server (the note was closed
  // while offline) go back into the note, around whatever was saved since.
  const left = takeUnsent(id);
  if (left) {
    const md = merge3(left.base.md, left.doc.md, doc.md);
    const title = left.doc.title !== left.base.title ? left.doc.title : doc.title;
    session.edit({ title, md, files: { ...doc.files, ...left.doc.files } });
  }

  // --- who is here -------------------------------------------------------------
  const shared = (): boolean => (useNotes.getState().notes[id]?.members ?? 1) > 1;
  let said = 0;
  const say = (hello = false): void => {
    if (closed || !shared() || document.visibilityState === "hidden") return;
    said = Date.now();
    void notesApi.presence(id, true, hello).catch(() => undefined);
  };
  say(true);
  const beat = setInterval(say, HERE_EVERY);
  let greet: ReturnType<typeof setTimeout> | null = null;

  const stopWatching = watchNote(id, {
    update: (d) => {
      // rekeyed: sealed with a key this page does not hold yet, so it is fetched with it
      if (d.version !== undefined) void session.remote(d.version, d.head !== undefined && d.body !== undefined && !d.rekeyed ? { head: d.head, body: d.body } : undefined);
      if (d.members && !greet) {
        // someone may have just been let in: said again once the list knows
        greet = setTimeout(() => {
          greet = null;
          say(true);
        }, 1500);
      }
    },
    presence: (d) => {
      if (d.hello && Date.now() - said > HELLO_GAP) say();
    },
    gone: () => {
      if (!closed) events.onGone();
    },
  });

  // --- leaving --------------------------------------------------------------------
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") void session.flush();
    else say(true);
  };
  const onPageHide = (): void => {
    leaving = true;
    void session.flush();
    if (shared()) void notesApi.presence(id, false, false, { keepalive: true }).catch(() => undefined);
  };
  const onPageShow = (): void => {
    leaving = false;
  };
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (session.state === "saved") return;
    // words that have not reached the server: the browser asks before leaving them
    void session.flush();
    e.preventDefault();
    e.returnValue = "";
  };
  const onOnline = (): void => {
    if (session.state === "offline") void session.retry();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("online", onOnline);

  return {
    id,
    session,
    key: () => key,
    close: () => {
      if (closed) return;
      const wasShared = shared();
      closed = true;
      clearInterval(beat);
      if (greet) clearTimeout(greet);
      stopWatching();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("online", onOnline);
      if (wasShared) void notesApi.presence(id, false).catch(() => undefined);
      // what is unsaved goes before the session stops listening for the answer
      void session.flush().finally(() => {
        // Could not be sent: kept for when the note is opened again. Not
        // once the app has locked or signed out, which forget what was readable.
        if (session.dirty && useKeys.getState().identity) keepUnsent(id, { doc: session.doc, base: session.saved });
        session.close();
        release?.();
        release = null;
      });
    },
  };
}
