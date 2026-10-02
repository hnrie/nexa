import { blobIds, headOf, pruned, type NoteDoc } from "./model";
import { applyDoc, bodyOf, docFromBody, hasDoc, readDoc, Y } from "./ydoc";
import { b64 } from "@/crypto/bytes";

/**
 * One open note: its CRDT document (ydoc.ts), the changes made here on their
 * way to everyone else, and the changes others made on their way in.
 *
 * Everything typed is put into the document as the smallest edit, and the
 * change it makes is sent a few milliseconds later, sealed, to the server,
 * which numbers it, keeps it and passes it on to whoever else has the note.
 * Their changes come in the same way and are taken into the document here,
 * then shown, with the caret kept where it was. However the changes cross,
 * every copy that has taken in the same ones reads the same: nothing is
 * merged after the fact, so nothing is doubled or lost.
 *
 * Every few seconds of writing the whole note is saved too, with the number
 * of the newest change it holds; the server lets those changes go. That save
 * names the version it was made from, and one that crossed someone else's
 * takes theirs in (a document takes in another whole document as easily as
 * a change) and goes again.
 *
 * Nothing here knows about the network or the keys: `deps` does the sending,
 * fetching, sealing and opening, which is what lets a test drive several
 * people's sessions against one pretend server.
 */

/** Where the note stands: everything sent, changes waiting, being sent, waiting for the connection, or refused. */
export type SaveState = "saved" | "unsaved" | "saving" | "offline" | "failed";

/** What kind of failure a request met. */
export type FailureKind = "stale" | "offline" | "rekeyed" | "saveFirst" | "other";

/** The note as the server has it saved. */
export interface Fetched {
  version: number;
  head: string;
  body: string;
  /** The newest change the saved body holds. */
  crdtUpto: number;
}

export interface SessionDeps {
  /** Seals one change with the note's key as it is now and sends it; resolves with the number it was given. */
  send: (update: Uint8Array, opts: { keepalive: boolean }) => Promise<{ seq: number }>;
  /** The sealed changes after a number, and where the saved note stands. */
  changes: (after: number) => Promise<{ updates: { seq: number; update: string }[]; crdtUpto: number; more: boolean }>;
  openUpdate: (sealed: string) => Promise<Uint8Array>;
  /** Saves the whole note, sealed, over version `base`, holding every change up to `upto`. */
  save: (head: string, body: string, base: number, files: string[], upto: number, opts: { keep: boolean; keepalive: boolean }) => Promise<{ version: number }>;
  fetch: () => Promise<Fetched>;
  seal: (part: "head" | "body", value: unknown) => Promise<string>;
  open: (part: "head" | "body", sealed: string) => Promise<unknown>;
  kind: (err: unknown) => FailureKind;
  /** The note has a new key: fetched before anything is sealed again. */
  rekeyed?: () => Promise<void>;
  /**
   * A save was refused for something in the note itself (a file the server
   * no longer has): the note without it, or null when there is no way round.
   */
  mend?: (err: unknown, doc: NoteDoc) => NoteDoc | null;
  /** How long a change waits for the next keystroke before it goes, and the longest it waits while they keep coming. */
  sendDelay?: number;
  sendMax?: number;
  /** How long after the last change the note is saved whole, and the longest that waits while the writing goes on. */
  saveIdle?: number;
  saveMax?: number;
  /** How long to wait before trying again while offline. */
  retry?: number;
}

export interface SessionEvents {
  /** The save state changed. */
  onState: (state: SaveState, error: unknown) => void;
  /**
   * Someone else's changes are in the note: the page shows `doc` in place of
   * what it has. `at` is where the page's carets go: what `caret` said, moved
   * past everything put in or taken out before them.
   */
  onRemote: (doc: NoteDoc, at?: Carets) => boolean;
  /** Where the page's carets are, as offsets into the note's text and its title, when it can say exactly. */
  caret?: () => Carets;
  /** What the page holds this instant, where that can be a frame ahead of the last edit(). */
  read?: () => Partial<NoteDoc>;
  /** Whether the page can take someone else's change just now: not while a word is being composed. */
  canShow?: () => boolean;
  /** The whole note was saved: its new version, and what it says. */
  onSaved?: (version: number, doc: NoteDoc) => void;
}

/** Carets as offsets: in the note's text, and the title's selection. Null where there is none, or it is not known. */
export interface Carets {
  md: number | null;
  title: [number, number] | null;
}

/** One change to a text, as Yjs says it. */
type DeltaOp = { retain?: number; insert?: unknown; delete?: number };

/**
 * Where an offset into a text is after a change to it. Something put in
 * right where it is goes after it: the caret stays with the words its own
 * person was just typing, and someone else's words land beyond it.
 */
export function moveThrough(at: number, delta: DeltaOp[]): number {
  let pos = 0;
  let shift = 0;
  for (const op of delta) {
    if (op.retain) pos += op.retain;
    else if (op.insert !== undefined) {
      if (pos < at) shift += typeof op.insert === "string" ? op.insert.length : 1;
    } else if (op.delete) {
      const end = pos + op.delete;
      if (end <= at) shift -= op.delete;
      else if (pos < at) shift -= at - pos;
      pos = end;
    }
    if (pos >= at && op.insert === undefined) break;
  }
  return Math.max(0, at + shift);
}

export interface SessionStart {
  noteId: string;
  version: number;
  /** The title the note's head has: the title of a note saved before it was kept as a document. */
  title: string;
  /** The note's body, opened. */
  body: unknown;
  /** The newest change the body holds. */
  crdtUpto: number;
  /** Changes made here the last time the note was open that never reached the server. */
  unsent?: Uint8Array | null;
}

const SEND_DELAY = 40;
const SEND_MAX = 250;
const SAVE_IDLE = 4000;
const SAVE_MAX = 20_000;
/** How soon to try again to show changes the page could not take (a word was being composed). */
const SHOW_AGAIN = 250;
/** How long a gap in the numbers is waited out before the missing changes are asked for. */
const GAP_WAIT = 1200;

/** Marks this copy's own edits, and what came from elsewhere, as the document applies them. */
const LOCAL = "local";
const REMOTE = "remote";

/** Another copy's change, or a whole saved note, waiting to be taken in. */
interface Incoming {
  update: Uint8Array;
  /** The number of the change, for a change. */
  seq?: number;
  /** For a whole saved note: the newest change it holds, and its version. */
  upto?: number;
  version?: number;
}

export class NoteSession {
  /** The note as it is on this page. */
  doc: NoteDoc;
  /** The version of the saved note this copy last saved over or took in. */
  version: number;
  state: SaveState = "saved";
  error: unknown = null;
  private y: Y.Doc;
  private readonly noteId: string;
  private readonly deps: SessionDeps;
  private readonly events: SessionEvents;
  /** Every change up to this number is in the document. */
  private applied: number;
  /** Changes past `applied` that are in the document already (arrived out of order, or this copy's own). */
  private have = new Set<number>();
  /** This copy's changes not yet sent, and the one being sent. */
  private outbox: Uint8Array[] = [];
  private inFlight: Uint8Array | null = null;
  private inbox: Incoming[] = [];
  private sending: Promise<void> | null = null;
  private sendAgain = false;
  private saving: Promise<void> | null = null;
  private catching: Promise<void> | null = null;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private firstQueued = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Edits made here since the note was last saved whole, and when the first of them was. */
  private edits = 0;
  private savedEdits = 0;
  private firstUnsaved = 0;
  private closed = false;
  /** The page is going away: what is sent rides a request that outlives it. */
  leaving = false;

  constructor(deps: SessionDeps, start: SessionStart, events: SessionEvents) {
    this.deps = deps;
    this.events = events;
    this.noteId = start.noteId;
    this.version = start.version;
    this.applied = start.crdtUpto;
    this.y = this.load(start.version, start.title, start.body);
    this.doc = readDoc(this.y);
    if (start.unsent?.length) {
      // put back as this copy's own, and sent again
      Y.applyUpdate(this.y, start.unsent, LOCAL);
      this.doc = readDoc(this.y);
      this.changed();
    }
  }

  /** The document a body holds (or is made from its text), with this copy's changes going out as they are made. */
  private load(version: number, title: string, body: unknown): Y.Doc {
    const doc = docFromBody(this.noteId, version, title, body);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL) this.queue(update);
    });
    return doc;
  }

  /** Whether changes made here have not reached the server yet. */
  get dirty(): boolean {
    return this.outbox.length > 0 || this.inFlight !== null;
  }

  /** This copy's changes the server does not have, as one update, to keep for the next time the note opens. */
  unsent(): Uint8Array | null {
    const all = [...(this.inFlight ? [this.inFlight] : []), ...this.outbox];
    if (all.length === 0) return null;
    return all.length === 1 ? all[0]! : Y.mergeUpdates(all);
  }

  private set(state: SaveState, error: unknown = null): void {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    if (!this.closed) this.events.onState(state, error);
  }

  // ---- this copy's changes -----------------------------------------------------

  /** The page's note changed. */
  edit(change: Partial<NoteDoc>): void {
    if (this.closed) return;
    if (!applyDoc(this.y, change, LOCAL)) return;
    this.doc = readDoc(this.y);
    this.changed();
  }

  private changed(): void {
    this.edits += 1;
    if (!this.firstUnsaved) this.firstUnsaved = Date.now();
    this.scheduleSave();
  }

  private queue(update: Uint8Array): void {
    this.outbox.push(update);
    if (this.state !== "saving" && this.state !== "offline") this.set("unsaved");
    this.scheduleSend();
  }

  private scheduleSend(after?: number): void {
    if (this.closed) return;
    const now = Date.now();
    if (!this.firstQueued) this.firstQueued = now;
    const wait = after ?? Math.max(0, Math.min(this.deps.sendDelay ?? SEND_DELAY, this.firstQueued + (this.deps.sendMax ?? SEND_MAX) - now));
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void this.send();
    }, wait);
  }

  /** Sends what is waiting now; resolves once it is sent or has failed. */
  private send(): Promise<void> {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.sending) {
      this.sendAgain = true;
      return this.sending;
    }
    if (this.outbox.length === 0) return Promise.resolve();
    this.sending = this.runSend().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async runSend(): Promise<void> {
    let tries = 0;
    do {
      this.sendAgain = false;
      this.firstQueued = 0;
      if (this.outbox.length === 0) break;
      const update = this.outbox.length === 1 ? this.outbox[0]! : Y.mergeUpdates(this.outbox);
      this.outbox = [];
      this.inFlight = update;
      this.set("saving");
      try {
        const res = await this.deps.send(update, { keepalive: this.leaving });
        this.inFlight = null;
        this.got(res.seq);
      } catch (err) {
        this.inFlight = null;
        this.outbox.unshift(update);
        const kind = this.deps.kind(err);
        if (kind === "rekeyed" && tries++ < 3) {
          // sealed again with the note's new key
          await this.deps.rekeyed?.().catch(() => undefined);
          this.sendAgain = true;
          continue;
        }
        if (kind === "saveFirst" && tries++ < 3) {
          await this.save({ force: true });
          this.sendAgain = true;
          continue;
        }
        if (kind === "offline") {
          this.set("offline", err);
          // tried again by itself: the words are safe here until it gets through
          this.scheduleSend(this.deps.retry ?? 4000);
          return;
        }
        this.set("failed", err);
        return;
      }
    } while (this.sendAgain || this.outbox.length > 0);
    if (!this.closed) this.set(this.outbox.length ? "unsaved" : "saved");
  }

  /** A change is in the document: counted in, and a gap behind it looked into. */
  private got(seq: number): void {
    if (seq <= this.applied) return;
    this.have.add(seq);
    this.advance();
  }

  /** Moves `applied` over every change held in order since it, and looks into a gap past it. */
  private advance(): void {
    for (const s of [...this.have]) if (s <= this.applied) this.have.delete(s);
    while (this.have.has(this.applied + 1)) {
      this.have.delete(this.applied + 1);
      this.applied += 1;
    }
    if (this.have.size > 0 && !this.gapTimer && !this.closed) {
      // one that overtook another is usually followed by it a moment later
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        if (this.have.size > 0) void this.catchUp();
      }, GAP_WAIT);
    }
  }

  // ---- others' changes -------------------------------------------------------------

  /** A change someone made, as the server passed it on. */
  async remote(ev: { seq: number; update?: string | undefined; cid: string }, mine: string): Promise<void> {
    if (this.closed) return;
    // this copy's own change, come back: the answer to sending it already counted it
    if (ev.cid === mine) {
      this.got(ev.seq);
      return;
    }
    if (ev.seq <= this.applied || this.have.has(ev.seq) || this.inbox.some((i) => i.seq === ev.seq)) return;
    if (!ev.update) {
      void this.catchUp();
      return;
    }
    let update: Uint8Array;
    try {
      update = await this.deps.openUpdate(ev.update);
    } catch {
      // sealed with a key this copy does not have yet: asked for again with it
      void this.catchUp();
      return;
    }
    this.inbox.push({ update, seq: ev.seq });
    this.show();
  }

  /**
   * Someone saved the note whole. A copy that already holds every change
   * that save holds just notes its version; one that does not takes in the
   * body that came along, or fetches it.
   */
  async remoteSave(ev: { version?: number | undefined; body?: string | undefined; upto?: number | undefined; reset?: boolean | undefined; rekeyed?: boolean | undefined }): Promise<void> {
    if (this.closed || ev.version === undefined) return;
    if (ev.rekeyed) {
      // the note has a new key, and every change kept so far went with the old one: the note is what its body says
      await this.deps.rekeyed?.().catch(() => undefined);
      await this.catchUp(true);
      return;
    }
    if (ev.reset) {
      await this.reset();
      return;
    }
    if (ev.version <= this.version) return;
    if (ev.upto !== undefined && ev.upto <= this.applied) {
      this.version = ev.version;
      return;
    }
    if (ev.body !== undefined) {
      try {
        const raw = await this.deps.open("body", ev.body);
        if (hasDoc(raw)) {
          this.inbox.push({ update: b64.dec(raw.y), upto: ev.upto ?? 0, version: ev.version });
          this.show();
          return;
        }
      } catch {
        /* fetched below */
      }
    }
    await this.catchUp(true);
  }

  /**
   * The note as an app from before notes were kept as documents saved it:
   * its text replaces this copy's, made a document the same way on every
   * device so all of them go on from the same one.
   */
  private async reset(): Promise<void> {
    const row = await this.deps.fetch();
    const head = (await this.deps.open("head", row.head).catch(() => null)) as { title?: unknown } | null;
    const body = await this.deps.open("body", row.body);
    if (hasDoc(body)) {
      this.inbox.push({ update: b64.dec(body.y), upto: row.crdtUpto, version: row.version });
      this.show();
      return;
    }
    this.y.destroy();
    this.y = this.load(row.version, typeof head?.title === "string" ? head.title : "", body);
    this.version = row.version;
    this.applied = row.crdtUpto;
    this.have.clear();
    this.inbox = [];
    // what was waiting to go was written against the note as it was
    this.outbox = [];
    this.doc = readDoc(this.y);
    this.events.onRemote(this.doc);
    if (this.state !== "failed") this.set("saved");
  }

  /** Takes in what is waiting, unless the page cannot show it just now. */
  private show(): void {
    if (this.closed || this.inbox.length === 0) return;
    if (this.events.canShow && !this.events.canShow()) {
      if (!this.showTimer) {
        this.showTimer = setTimeout(() => {
          this.showTimer = null;
          this.show();
        }, SHOW_AGAIN);
      }
      return;
    }
    // what the page holds this instant first, so nothing typed a moment ago is lost under it
    const now = this.events.read?.();
    if (now) this.edit(now);
    // where the carets are, in the text as it is before the others' changes go in
    const before = this.events.caret?.() ?? null;
    const incoming = this.inbox;
    this.inbox = [];
    const md = this.y.getText("md");
    const title = this.y.getText("title");
    let mdDelta: DeltaOp[] | null = null;
    let titleDelta: DeltaOp[] | null = null;
    const onMd = (e: Y.YTextEvent) => {
      mdDelta = e.delta as DeltaOp[];
    };
    const onTitle = (e: Y.YTextEvent) => {
      titleDelta = e.delta as DeltaOp[];
    };
    md.observe(onMd);
    title.observe(onTitle);
    try {
      Y.transact(
        this.y,
        () => {
          for (const i of incoming) Y.applyUpdate(this.y, i.update, REMOTE);
        },
        REMOTE,
      );
    } finally {
      md.unobserve(onMd);
      title.unobserve(onTitle);
    }
    const at: Carets | undefined = before
      ? {
          md: before.md === null ? null : mdDelta ? moveThrough(before.md, mdDelta) : before.md,
          title: before.title === null ? null : titleDelta ? [moveThrough(before.title[0], titleDelta), moveThrough(before.title[1], titleDelta)] : before.title,
        }
      : undefined;
    for (const i of incoming) {
      if (i.seq !== undefined && i.seq > this.applied) this.have.add(i.seq);
      // a whole saved note holds every change up to its number
      if (i.upto !== undefined && i.upto > this.applied) this.applied = i.upto;
      if (i.version !== undefined && i.version > this.version) this.version = i.version;
    }
    this.advance();
    const next = readDoc(this.y);
    const same = next.md === this.doc.md && next.title === this.doc.title && JSON.stringify(next.files) === JSON.stringify(this.doc.files);
    this.doc = next;
    if (!same) this.events.onRemote(next, at);
  }

  /**
   * Asks for the changes after the newest this copy holds in order: after a
   * gap in the numbers, a connection that was down, or a change too big to
   * be passed on. A saved note that holds changes this copy never got is
   * taken in whole first.
   */
  catchUp(force = false): Promise<void> {
    if (this.catching) return this.catching;
    if (this.closed) return Promise.resolve();
    this.catching = (async () => {
      // the changes are fetched from here on: what is held, or waiting to be shown, stays out
      let after = this.applied;
      for (let round = 0; round < 50; round++) {
        const res = await this.deps.changes(after);
        if (res.crdtUpto > after || (force && round === 0)) {
          // the saved note holds changes this copy never got (or was asked to be taken in): it comes first
          const row = await this.deps.fetch();
          const raw = await this.deps.open("body", row.body);
          if (!hasDoc(raw)) {
            await this.reset();
            return;
          }
          this.inbox.push({ update: b64.dec(raw.y), upto: row.crdtUpto, version: row.version });
          if (row.crdtUpto > after) {
            // what was fetched before it may have been let go meanwhile: asked for again from there
            after = row.crdtUpto;
            this.show();
            continue;
          }
        }
        for (const u of res.updates) {
          if (u.seq > after) after = u.seq;
          if (u.seq <= this.applied || this.have.has(u.seq) || this.inbox.some((i) => i.seq === u.seq)) continue;
          try {
            this.inbox.push({ update: await this.deps.openUpdate(u.update), seq: u.seq });
          } catch {
            // one that will not open is skipped; the next whole save of the note carries it
          }
        }
        this.show();
        if (!res.more) break;
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        this.catching = null;
      });
    return this.catching;
  }

  // ---- saving the whole note --------------------------------------------------------

  private scheduleSave(after?: number): void {
    if (this.closed) return;
    const now = Date.now();
    // a little apart for each copy, so two people writing do not save over each other every time
    const jitter = this.deps.saveIdle === undefined ? Math.random() * 1500 : 0;
    const wait = after ?? Math.max(0, Math.min((this.deps.saveIdle ?? SAVE_IDLE) + jitter, this.firstUnsaved + (this.deps.saveMax ?? SAVE_MAX) - now));
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, wait);
  }

  /**
   * Saves the whole note, if anything was written here since it last was,
   * or whatever was: `force` (the server asked for it), `keep` (the state it
   * replaces is set aside as a version).
   */
  save(opts: { keep?: boolean; force?: boolean } = {}): Promise<void> {
    const keep = opts.keep ?? false;
    const wanted = keep || opts.force || this.edits !== this.savedEdits;
    if (this.saving) return this.saving.then(() => (wanted && (keep || opts.force || this.edits !== this.savedEdits) ? this.save(opts) : undefined));
    if (this.closed && !this.leaving) return Promise.resolve();
    if (!wanted) return Promise.resolve();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saving = this.runSave(keep).finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async runSave(keep: boolean): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const edits = this.edits;
      const doc = this.doc;
      const sent: NoteDoc = { title: doc.title, ...pruned(doc) };
      try {
        const [head, body] = await Promise.all([this.deps.seal("head", headOf(sent)), this.deps.seal("body", bodyOf(this.y, sent))]);
        const res = await this.deps.save(head, body, this.version, blobIds(sent), this.applied, { keep, keepalive: this.leaving });
        this.version = res.version;
        this.savedEdits = edits;
        if (this.edits === edits) this.firstUnsaved = 0;
        else this.scheduleSave();
        this.events.onSaved?.(res.version, sent);
        return;
      } catch (err) {
        const kind = this.deps.kind(err);
        if (kind === "stale") {
          // someone saved first: theirs is taken in, and this goes again over it
          await this.catchUp(true);
          if (this.inbox.length > 0) {
            // the page cannot take it in just now (a word is being composed): saved a moment later
            this.scheduleSave(1000);
            return;
          }
          continue;
        }
        if (kind === "rekeyed") {
          await this.deps.rekeyed?.().catch(() => undefined);
          continue;
        }
        const fixed = kind === "other" && this.deps.mend ? this.deps.mend(err, this.doc) : null;
        if (fixed) {
          // a file the server would not keep: the note without it
          this.edit(fixed);
          this.events.onRemote(this.doc);
          continue;
        }
        // the changes themselves are safe on the server; the whole note is saved again later
        this.scheduleSave(kind === "offline" ? (this.deps.retry ?? 4000) * 2 : 30_000);
        return;
      }
    }
  }

  // ---- for the page ------------------------------------------------------------------------

  /** Sends what is waiting and saves the note whole if it was written in; resolves once both are done or have failed. */
  async flush(): Promise<void> {
    await this.send();
    await this.save();
  }

  /**
   * Puts an earlier state of the note back: shown here, sent to everyone as
   * this copy's change, and saved with the state it replaces set aside as a
   * version, so putting something back never loses what was there. False
   * when it could not be sent.
   */
  async restore(doc: NoteDoc): Promise<boolean> {
    if (this.closed) return false;
    await this.flush();
    this.edit(doc);
    this.events.onRemote(this.doc);
    await this.send();
    if (this.state === "failed" || this.state === "offline") return false;
    await this.save({ keep: true });
    return true;
  }

  /** Tries again after a send that was refused. */
  retry(): Promise<void> {
    if (this.dirty) this.set("unsaved");
    return this.flush();
  }

  /** Stops listening and sending. What is unsent is the caller's to flush first. */
  close(): void {
    this.closed = true;
    for (const t of [this.sendTimer, this.saveTimer, this.showTimer, this.gapTimer]) if (t) clearTimeout(t);
    this.sendTimer = this.saveTimer = this.showTimer = this.gapTimer = null;
  }

  /** The note's whole document, for a test or a rekey that has to carry everything. */
  get ydoc(): Y.Doc {
    return this.y;
  }

  /** The newest change this copy holds every change up to. */
  get upto(): number {
    return this.applied;
  }
}
