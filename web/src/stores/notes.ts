import { create } from "zustand";
import { ApiError } from "@/api/client";
import { notes as notesApi } from "@/api/notes";
import { NOTE_OWNER, type NoteCrdtEvent, type NoteInviteRow, type NotePresenceEvent, type NoteRole, type NoteRow, type NoteUpdateEvent, type PublicUser } from "@/api/types";
import { openNote, openNoteKey } from "@/crypto/notes";
import { forgetNoteKey, forgetNoteKeys, heldNoteKey, keepNoteKeys, noteKeyOf } from "@/lib/notes/keys";
import { readHead, type NoteHead } from "@/lib/notes/model";
import { forgetRekeys, rekeyNote } from "@/lib/notes/rekey";
import { forgetUnsent } from "@/lib/notes/unsent";
import { forgetNoteLinkPreviews } from "@/lib/notes/linkPreview";
import { useKeys } from "./keys";
import { useUsers } from "./users";

/**
 * The notes this account has, and the invitations waiting for it.
 *
 * The server sends every note sealed. Each note's key is opened with this
 * account's identity key (lib/notes/keys.ts) and its head with that, so the
 * list has titles and first lines to show. A note's text is not kept here: it
 * is fetched and opened when the note is (lib/notes/open.ts).
 */

export interface NoteItem {
  id: string;
  ownerId: string;
  role: NoteRole;
  version: number;
  createdAt: number;
  updatedAt: number;
  editedBy: string | null;
  /** How many people it is shared with, the owner included. */
  members: number;
  keyEpoch: number;
  /** The title and first lines; null when the note could not be opened on this device. */
  head: NoteHead | null;
}

export interface NoteInviteItem {
  id: string;
  noteId: string;
  role: NoteRole;
  from: PublicUser;
  createdAt: number;
  head: NoteHead | null;
}

/** How long someone counts as being in a note after they last said so. They say so every twenty seconds. */
export const HERE_TTL = 50_000;

interface NotesState {
  status: "idle" | "loading" | "ready" | "error";
  notes: Record<string, NoteItem>;
  invites: NoteInviteItem[];
  /** Who else has each note open: note id, then user id, then when they last said so. */
  here: Record<string, Record<string, number>>;
  /** Counts changes to who each note is shared with, so a dialog showing that knows to look again. */
  sharing: Record<string, number>;
  load: (force?: boolean) => Promise<void>;
  /** Puts a note the server just sent (created, joined, fetched) in the list. */
  put: (row: NoteRow) => Promise<NoteItem>;
  drop: (id: string) => void;
  dropInvite: (id: string) => void;
  clear: () => void;
  updated: (d: NoteUpdateEvent) => void;
  invited: (row: NoteInviteRow) => void;
  present: (d: NotePresenceEvent) => void;
  /** Where someone's caret is in a note: passed to the page that has it open, and kept nowhere. */
  cursor: (d: NoteCursorEvent) => void;
  /** A change someone made to a note: passed to the page that has it open, and kept nowhere. */
  crdt: (d: NoteCrdtEvent) => void;
  /** What a note being written on this page says now, for the list, ahead of its next save. */
  shown: (id: string, head: NoteHead, by: string | null) => void;
}

/** Someone's caret in a note, as the gateway passes it on (sealed). */
export interface NoteCursorEvent {
  id: string;
  user_id: string;
  data: string;
}

// --- one note's events, for the page that has it open ---------------------------

export interface NoteListener {
  update?: (d: NoteUpdateEvent) => void;
  presence?: (d: NotePresenceEvent) => void;
  cursor?: (d: NoteCursorEvent) => void;
  crdt?: (d: NoteCrdtEvent) => void;
  /** The note is gone for this account: deleted, or this account is out of it. */
  gone?: () => void;
}

const listeners = new Map<string, Set<NoteListener>>();

/** Follows one note's events while it is open on this page; returns how to stop. */
export function watchNote(id: string, l: NoteListener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  const mine = set;
  mine.add(l);
  return () => {
    mine.delete(l);
    if (mine.size === 0 && listeners.get(id) === mine) listeners.delete(id);
  };
}

// --- rows into items --------------------------------------------------------------

async function item(row: NoteRow): Promise<NoteItem> {
  let head: NoteHead | null = null;
  try {
    head = readHead(await openNote(await noteKeyOf(row), "head", row.head));
  } catch {
    // listed all the same, as a note this device cannot open
    head = null;
  }
  return { id: row.id, ownerId: row.owner_id, role: row.role, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, editedBy: row.edited_by, members: row.members, keyEpoch: row.key_epoch, head };
}

async function inviteItem(row: NoteInviteRow): Promise<NoteInviteItem> {
  let head: NoteHead | null = null;
  try {
    const identity = useKeys.getState().identity;
    if (identity) head = readHead(await openNote(await openNoteKey(identity, row.key_sealed), "head", row.head));
  } catch {
    head = null;
  }
  return { id: row.id, noteId: row.note_id, role: row.role, from: row.from, createdAt: row.created_at, head };
}

/** A note this account owns that someone holding its key has left gets a new key (lib/notes/rekey.ts). */
function mind(row: NoteRow): void {
  if (row.role === NOTE_OWNER && row.needs_rekey) void rekeyNote(row.id);
}

/**
 * Fetches a note and puts it in the list as it is now: after it got a new
 * key, after this account's role in it changed, or to open it. A note that
 * turns out to be gone is taken off the list.
 */
export async function refreshNote(id: string): Promise<{ row: NoteRow; key: Uint8Array }> {
  let row: NoteRow;
  try {
    row = await notesApi.get(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) useNotes.getState().drop(id);
    throw err;
  }
  const key = await noteKeyOf(row);
  await useNotes.getState().put(row);
  return { row, key };
}

let loading: Promise<void> | null = null;
/** Counts loads, so an answer that comes back after signing out, or after a newer load, is dropped. */
let generation = 0;
/** Counts sessions: what was asked for one account is not put in the next one's list. */
let session = 0;

export const useNotes = create<NotesState>()((set, get) => ({
  status: "idle",
  notes: {},
  invites: [],
  here: {},
  sharing: {},

  load: (force = false) => {
    if (loading && !force) return loading;
    if (!force && get().status === "ready") return Promise.resolve();
    const mine = (generation += 1);
    if (get().status !== "ready") set({ status: "loading" });
    const run = (async () => {
      try {
        const res = await notesApi.list();
        const [items, invites] = await Promise.all([Promise.all(res.notes.map(item)), Promise.all(res.invites.map(inviteItem))]);
        if (mine !== generation) return;
        useUsers.getState().upsert(res.invites.map((i) => i.from));
        const notes: Record<string, NoteItem> = {};
        for (const n of items) notes[n.id] = n;
        keepNoteKeys(new Set(Object.keys(notes)));
        // whoever was in a note that is gone is no longer anywhere
        const here: NotesState["here"] = {};
        for (const [id, people] of Object.entries(get().here)) if (notes[id]) here[id] = people;
        set({ status: "ready", notes, invites, here });
        // a note on the page that is no longer listed is gone
        for (const [id, watching] of [...listeners]) if (!notes[id]) for (const l of [...watching]) l.gone?.();
        res.notes.forEach(mind);
      } catch {
        if (mine === generation && get().status !== "ready") set({ status: "error" });
      }
    })().finally(() => {
      if (loading === run) loading = null;
    });
    loading = run;
    return run;
  },

  put: async (row) => {
    const mine = session;
    const it = await item(row);
    if (mine !== session) return it;
    set((s) => {
      const cur = s.notes[it.id];
      // an older answer does not replace what a newer one already put there
      if (cur && cur.version > it.version) return s;
      return { notes: { ...s.notes, [it.id]: it } };
    });
    mind(row);
    return it;
  },

  drop: (id) => {
    forgetNoteKey(id);
    forgetUnsent(id);
    for (const l of [...(listeners.get(id) ?? [])]) l.gone?.();
    set((s) => {
      if (!(id in s.notes) && !(id in s.here)) return s;
      const notes = { ...s.notes };
      const here = { ...s.here };
      delete notes[id];
      delete here[id];
      return { notes, here };
    });
  },

  dropInvite: (id) => set((s) => (s.invites.some((i) => i.id === id) ? { invites: s.invites.filter((i) => i.id !== id) } : s)),

  clear: () => {
    generation += 1;
    session += 1;
    loading = null;
    forgetNoteKeys();
    forgetRekeys();
    // a note in the clear does not outlast the keys that opened it, nor do the links opened
    forgetUnsent();
    forgetNoteLinkPreviews();
    set({ status: "idle", notes: {}, invites: [], here: {}, sharing: {} });
  },

  updated: (d) => {
    for (const l of [...(listeners.get(d.id) ?? [])]) l.update?.(d);
    if (d.members) set((s) => ({ sharing: { ...s.sharing, [d.id]: (s.sharing[d.id] ?? 0) + 1 } }));
    const known = get().notes[d.id];
    if (!known) {
      // a note this account was just let into, or made on another device
      if (get().status !== "idle") void get().load(true);
      return;
    }
    if (d.rekeyed || d.members || d.removed) {
      // the key, this account's role or how many it is shared with changed: the note is asked for again
      void refreshNote(d.id).catch(() => undefined);
      return;
    }
    const version = d.version;
    const sealed = d.head;
    if (version === undefined || sealed === undefined || version <= known.version) return;
    const have = heldNoteKey(d.id);
    const mine = session;
    void (async () => {
      let head: NoteHead | null;
      try {
        if (!have) throw new Error("no key");
        head = readHead(await openNote(have.key, "head", sealed));
      } catch {
        // sealed with a key this device does not have yet: fetched with it
        void refreshNote(d.id).catch(() => undefined);
        return;
      }
      if (mine !== session) return;
      set((s) => {
        const cur = s.notes[d.id];
        if (!cur || cur.version >= version) return s;
        return { notes: { ...s.notes, [d.id]: { ...cur, head, version, updatedAt: d.updated_at ?? cur.updatedAt, editedBy: d.edited_by ?? cur.editedBy } } };
      });
    })();
  },

  invited: (row) => {
    useUsers.getState().upsert(row.from);
    const mine = session;
    void inviteItem(row).then((it) => {
      if (mine !== session) return;
      set((s) => ({ invites: [it, ...s.invites.filter((i) => i.id !== it.id)] }));
    });
  },

  cursor: (d) => {
    for (const l of [...(listeners.get(d.id) ?? [])]) l.cursor?.(d);
  },

  shown: (id, head, by) => {
    set((s) => {
      const known = s.notes[id];
      if (!known) return s;
      // someone else's words keep the time and name their own change gave the note
      return { notes: { ...s.notes, [id]: { ...known, head, updatedAt: by ? Math.max(known.updatedAt, Date.now()) : known.updatedAt, editedBy: by ?? known.editedBy } } };
    });
  },

  crdt: (d) => {
    for (const l of [...(listeners.get(d.id) ?? [])]) l.crdt?.(d);
    // the list shows when it was last written in, and by whom
    set((s) => {
      const known = s.notes[d.id];
      return known && d.at > known.updatedAt ? { notes: { ...s.notes, [d.id]: { ...known, updatedAt: d.at, editedBy: d.user_id } } } : s;
    });
  },

  present: (d) => {
    for (const l of [...(listeners.get(d.id) ?? [])]) l.presence?.(d);
    set((s) => {
      const cur = s.here[d.id] ?? {};
      if (!d.here && !(d.user_id in cur)) return s;
      const next = { ...cur };
      if (d.here) next[d.user_id] = Date.now();
      else delete next[d.user_id];
      return { here: { ...s.here, [d.id]: next } };
    });
  },
}));

/** The people in a note right now, besides this account: those who said so within HERE_TTL. */
export function peopleHere(here: Record<string, number> | undefined, now = Date.now()): string[] {
  if (!here) return [];
  return Object.entries(here)
    .filter(([, at]) => now - at < HERE_TTL)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

/** This account's notes, the one written in last first. */
export function sortedNotes(notes: Record<string, NoteItem>): NoteItem[] {
  return Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
}
