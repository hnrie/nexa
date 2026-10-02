import { ApiError } from "@/api/client";
import { notes as notesApi } from "@/api/notes";
import type { NoteRow } from "@/api/types";
import { randomBytes } from "@/crypto/bytes";
import { DecryptError } from "@/crypto/keys";
import { b64url, openNote, openNoteUpdate, sealNote, sealNoteUpdate } from "@/crypto/notes";
import { holdReload } from "@/lib/busy";
import { onReadyApplied } from "@/gateway/dispatch";
import { useKeys } from "@/stores/keys";
import { refreshNote, useNotes, watchNote } from "@/stores/notes";
import { noteKeyOf } from "./keys";
import { readHead, withoutFiles, type NoteDoc } from "./model";
import { NoteSession, type FailureKind, type SaveState, type SessionEvents } from "./session";
import { keepUnsent, takeUnsent } from "./unsent";

/**
 * A note open on the page: its session (session.ts) joined to the server,
 * the note's key and the gateway.
 *
 * The changes others make arrive as events and go into the session, which
 * takes them into its document and shows them. The note's key can change
 * under an open note (its owner's app gives it a new one when someone
 * leaves): a sealed part that will not open with the key held is tried again
 * with the key the server has for this account now. And everyone with the
 * note open says so every little while, which is all "who is here" is.
 */

/** What kind of failure a save or a fetch met. */
export function failureKind(err: unknown): FailureKind {
  if (!(err instanceof ApiError)) return "other";
  if (err.code === "note_stale") return "stale";
  if (err.code === "note_rekeyed") return "rekeyed";
  if (err.code === "note_save_first") return "saveFirst";
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
  let epoch = first.row.key_epoch;
  let closed = false;
  /** This open copy of the note, so its own changes are known when the server passes them back. */
  const cid = b64url.enc(randomBytes(9));

  const fetchRow = async (): Promise<NoteRow> => {
    const row = await notesApi.get(id);
    key = await noteKeyOf(row);
    epoch = row.key_epoch;
    void useNotes.getState().put(row);
    return row;
  };
  /** Opens something sealed with the note's key, asking for the key again once if it will not open. */
  const withKey = async <T,>(work: (k: Uint8Array) => Promise<T>): Promise<T> => {
    const used = key;
    try {
      return await work(used);
    } catch (err) {
      if (!(err instanceof DecryptError)) throw err;
      // sealed with a key newer than the one held: asked for, and tried once more
      if (key === used) await fetchRow();
      if (key === used) throw err;
      return work(key);
    }
  };
  const open = (part: "head" | "body", sealed: string): Promise<unknown> => withKey((k) => openNote(k, part, sealed));

  const [head, body] = await Promise.all([open("head", first.row.head), open("body", first.row.body ?? "")]);

  // a new version of the app waits for a note whose changes are still being sent
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
      send: async (update, opts) => {
        // sealed and sent with the same key, so the server can say when that key is no longer the note's
        const k = key;
        const e = epoch;
        const sealed = await sealNoteUpdate(k, update);
        return notesApi.postUpdate(id, sealed, e, cid, { keepalive: opts.keepalive && sealed.length < KEEPALIVE_MAX });
      },
      changes: async (after) => {
        const res = await notesApi.updates(id, after);
        return { updates: res.updates, crdtUpto: res.crdt_upto, more: res.more };
      },
      openUpdate: (sealed) => withKey((k) => openNoteUpdate(k, sealed)),
      save: async (sealedHead, sealedBody, base, files, upto, opts) => {
        const res = await notesApi.save(id, sealedHead, sealedBody, base, files, upto, { keep: opts.keep, keepalive: opts.keepalive && sealedHead.length + sealedBody.length < KEEPALIVE_MAX });
        return { version: res.version };
      },
      fetch: async () => {
        const row = await fetchRow();
        return { version: row.version, head: row.head, body: row.body ?? "", crdtUpto: row.crdt_upto ?? 0 };
      },
      seal: (part, value) => sealNote(key, part, value),
      open,
      kind: failureKind,
      rekeyed: async () => {
        await fetchRow();
      },
      mend: withoutRefusedFiles,
    },
    { noteId: id, version: first.row.version, title: readHead(head).title, body, crdtUpto: first.row.crdt_upto ?? 0, unsent: takeUnsent(id) },
    {
      ...events,
      onState: (state, error) => {
        hold(state);
        events.onState(state, error);
      },
    },
  );
  // the changes made since the note was last saved whole
  void session.catchUp();

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
    crdt: (d) => {
      void session.remote(d, cid);
    },
    update: (d) => {
      if (d.version !== undefined) void session.remoteSave(d);
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
  // back from a connection that was down: whatever changed meanwhile
  const stopReady = onReadyApplied(() => {
    if (!closed) void session.catchUp();
  });

  // --- leaving --------------------------------------------------------------------
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") void session.flush();
    else {
      say(true);
      void session.catchUp();
    }
  };
  const onPageHide = (): void => {
    session.leaving = true;
    void session.flush();
    if (shared()) void notesApi.presence(id, false, false, { keepalive: true }).catch(() => undefined);
  };
  const onPageShow = (): void => {
    session.leaving = false;
  };
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!session.dirty) return;
    // words that have not reached the server: the browser asks before leaving them
    void session.flush();
    e.preventDefault();
    e.returnValue = "";
  };
  const onOnline = (): void => {
    if (session.state === "offline") void session.retry();
    void session.catchUp();
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
      stopReady();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("online", onOnline);
      if (wasShared) void notesApi.presence(id, false).catch(() => undefined);
      // what is unsent goes before the session stops listening for the answer
      void session.flush().finally(() => {
        // Could not be sent: kept for when the note is opened again. Not
        // once the app has locked or signed out, which forget what was readable.
        const left = session.unsent();
        if (left && useKeys.getState().identity) keepUnsent(id, left);
        session.close();
        release?.();
        release = null;
      });
    },
  };
}
