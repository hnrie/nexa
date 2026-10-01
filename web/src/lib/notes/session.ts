import { merge3 } from "./merge";
import { blobIds, headOf, pruned, readBody, readHead, sameDoc, type NoteDoc } from "./model";

/**
 * One open note: what it says here, what it said when it was last saved, and
 * the saving in between.
 *
 * A note saves itself, and people writing in one together see each other's
 * words arrive. A fraction of a second after the typing pauses, the note is
 * sealed and sent, naming the version it was made from, and the server sends
 * it on to everyone else who has the note. Their session puts it together
 * with whatever they have typed since (merge.ts) and shows the result, with
 * the caret where it was. When two saves cross, the server refuses the later
 * one; it takes the other in the same way and is sent again. Nothing here
 * knows about the network or the keys: `deps` does the fetching, saving,
 * sealing and opening, which is what lets a test drive two people's sessions
 * against one pretend server.
 */

/** Where a note stands: all saved, changed since, being saved, waiting for the connection, or refused. */
export type SaveState = "saved" | "unsaved" | "saving" | "offline" | "failed";

export interface Fetched {
  version: number;
  head: string;
  body: string;
}

export interface SessionDeps {
  /**
   * Sends a sealed note. Rejects with a `stale` error when the note has moved
   * on, `offline` when it cannot be reached. `keep` asks for the state being
   * replaced to be set aside as a version.
   */
  save: (head: string, body: string, base: number, files: string[], keep: boolean) => Promise<{ version: number }>;
  fetch: () => Promise<Fetched>;
  seal: (part: "head" | "body", value: unknown) => Promise<string>;
  open: (part: "head" | "body", sealed: string) => Promise<unknown>;
  /** What kind of failure an error is. */
  kind: (err: unknown) => "stale" | "offline" | "other";
  /**
   * A save was refused for something in the note itself (a file the server
   * no longer has): the note without it, to save instead, or null when the
   * refusal is not one that can be worked around.
   */
  mend?: (err: unknown, doc: NoteDoc) => NoteDoc | null;
  /** How long after the last change a save starts, and the longest a change waits while the typing never pauses. */
  delay?: number;
  maxDelay?: number;
  /** How long to wait before trying again while offline. */
  retry?: number;
}

/** Saves follow the typing closely, so that others in the note see it as it is written. */
const DELAY = 350;
const MAX_DELAY = 1200;
/** A long note is sealed and sent whole each time, so it waits a little longer: this many characters add a millisecond. */
const CHARS_PER_MS = 120;
/** How soon to try again to show someone else's change that could not be shown (a word was being composed). */
const SHOW_AGAIN = 300;

export interface SessionEvents {
  /** The save state changed. */
  onState: (state: SaveState, error: unknown) => void;
  /**
   * Someone else's changes were put into the note: the page shows `doc` in
   * place of what it has. False when it cannot swap its text just now (a
   * word is being composed); nothing is changed then, and it is tried again.
   */
  onRemote: (doc: NoteDoc) => boolean;
  /** What the page holds this instant, where that can be a frame ahead of the last edit(). */
  read?: () => Partial<NoteDoc>;
  /** A save landed: the note's new version, and what it now says. */
  onSaved?: (version: number, doc: NoteDoc) => void;
}

export class NoteSession {
  /** The note as it is on this page. */
  doc: NoteDoc;
  /** The note as of `version`: what the server has. */
  private base: NoteDoc;
  version: number;
  state: SaveState = "saved";
  error: unknown = null;
  private readonly deps: SessionDeps;
  private readonly events: SessionEvents;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstChange = 0;
  private busy: Promise<void> | null = null;
  private again = false;
  private closed = false;
  /** The newest state the server announced that has not been taken in yet: its version, and the note itself when it came along. */
  private announced: Fetched | { version: number } | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  /** The next save sets the state it replaces aside as a version. */
  private keep = false;

  constructor(deps: SessionDeps, start: { version: number; doc: NoteDoc }, events: SessionEvents) {
    this.deps = deps;
    this.events = events;
    this.version = start.version;
    this.doc = start.doc;
    this.base = start.doc;
  }

  get dirty(): boolean {
    return !sameDoc(this.doc, this.base);
  }

  /** The note as the server has it, as far as this page knows. */
  get saved(): NoteDoc {
    return this.base;
  }

  private set(state: SaveState, error: unknown = null): void {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    if (!this.closed) this.events.onState(state, error);
  }

  /** The page's note changed. */
  edit(change: Partial<NoteDoc>): void {
    if (this.closed) return;
    this.doc = { ...this.doc, ...change };
    if (!this.dirty) {
      // changed and changed back before anything was sent
      if (!this.busy && this.state !== "failed") this.set("saved");
      return;
    }
    if (!this.busy) this.set("unsaved");
    this.schedule();
  }

  private schedule(after?: number): void {
    if (this.closed) return;
    const now = Date.now();
    if (!this.firstChange) this.firstChange = now;
    const long = Math.min(1500, Math.floor(this.doc.md.length / CHARS_PER_MS));
    const delay = (this.deps.delay ?? DELAY) + long;
    const wait = after ?? Math.max(0, Math.min(delay, this.firstChange + (this.deps.maxDelay ?? MAX_DELAY) + long - now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /** Saves now, if there is anything to save; resolves once the note is saved or the save has failed. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.busy) {
      this.again = true;
      return this.busy;
    }
    if (this.closed || !this.dirty) return Promise.resolve();
    this.busy = this.run().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async run(): Promise<void> {
    // how many saves in a row were refused as stale; a server that keeps
    // saying so without ever showing a newer note is not waited on for ever
    let refused = 0;
    let mended = 0;
    do {
      this.again = false;
      if (this.closed || !this.dirty) break;
      this.firstChange = 0;
      this.set("saving");
      const sent: NoteDoc = { title: this.doc.title, ...pruned(this.doc) };
      const keep = this.keep;
      try {
        const [head, body] = await Promise.all([this.deps.seal("head", headOf(sent)), this.deps.seal("body", { md: sent.md, files: sent.files })]);
        const res = await this.deps.save(head, body, this.version, blobIds(sent), keep);
        if (keep) this.keep = false;
        this.version = res.version;
        this.base = sent;
        this.events.onSaved?.(res.version, sent);
        // typed on while it was in the air
        if (this.dirty) this.again = true;
      } catch (err) {
        const kind = this.deps.kind(err);
        if (kind === "stale" && (refused += 1) <= 4) {
          // someone else saved first: take theirs in, and save the two together
          try {
            if (await this.pull(this.takeAnnounced())) this.again = this.dirty;
            else {
              // the page could not show it just now; saving waits until it can
              this.set("unsaved");
              this.schedule(SHOW_AGAIN);
              return;
            }
          } catch (pullErr) {
            this.failed(pullErr);
            return;
          }
        } else {
          // refused for something the note holds that the server will not take: saved without it
          const fixed = kind === "other" && mended < 2 ? this.mended(err) : null;
          if (!fixed) {
            this.failed(err);
            return;
          }
          mended += 1;
          if (!this.events.onRemote(fixed)) {
            this.set("unsaved");
            this.schedule(SHOW_AGAIN);
            return;
          }
          this.doc = fixed;
          this.again = this.dirty;
        }
      }
    } while (this.again);
    if (this.closed) return;
    this.set(this.dirty ? "unsaved" : "saved");
    // a newer version announced while this was going on
    const waiting = this.takeAnnounced();
    if (waiting) queueMicrotask(() => void this.remote(waiting.version, "head" in waiting ? waiting : undefined));
  }

  /** The note as it can be saved after a refusal, if the refusal is one `deps.mend` knows a way around. */
  private mended(err: unknown): NoteDoc | null {
    if (!this.deps.mend) return null;
    // what the page holds this instant, as in pull()
    if (this.events.read) this.doc = { ...this.doc, ...this.events.read() };
    return this.deps.mend(err, this.doc);
  }

  /** The announced state still worth taking in, if any. */
  private takeAnnounced(): Fetched | { version: number } | null {
    const a = this.announced;
    this.announced = null;
    return a && a.version > this.version ? a : null;
  }

  private failed(err: unknown): void {
    if (this.deps.kind(err) === "offline") {
      this.set("offline", err);
      // tried again by itself: the words are safe here until it gets through
      this.schedule(this.deps.retry ?? 5000);
      return;
    }
    this.set("failed", err);
  }

  /**
   * Takes in the note as someone else saved it: `given` when the server sent
   * it along, fetched otherwise. Their changes and this page's are put
   * together and the page shows the result. False when the page could not
   * show it; nothing has changed then.
   */
  private async pull(given?: Fetched | { version: number } | null): Promise<boolean> {
    const got = given && "head" in given && given.version > this.version ? given : await this.deps.fetch();
    if (got.version <= this.version) return true;
    const [headRaw, bodyRaw] = await Promise.all([this.deps.open("head", got.head), this.deps.open("body", got.body)]);
    const head = readHead(headRaw);
    const body = readBody(bodyRaw);
    const theirs: NoteDoc = { title: head.title, md: body.md, files: body.files };
    // what the page holds this instant, which a fast typist keeps a frame ahead of edit()
    if (this.events.read) this.doc = { ...this.doc, ...this.events.read() };
    const md = merge3(this.base.md, this.doc.md, theirs.md);
    // a title is one line: whoever changed it last here keeps theirs, otherwise the saved one stands
    const title = this.doc.title !== this.base.title ? this.doc.title : theirs.title;
    const merged: NoteDoc = { title, md, files: { ...theirs.files, ...this.doc.files } };
    const changed = merged.md !== this.doc.md || merged.title !== this.doc.title;
    if (changed && !this.closed && !this.events.onRemote(merged)) return false;
    this.base = theirs;
    this.version = got.version;
    this.doc = merged;
    return true;
  }

  /** The server says the note is at `version` now, and may have sent the note along. */
  async remote(version: number, note?: { head: string; body: string }): Promise<void> {
    if (this.closed || version <= this.version) return;
    const told: Fetched | { version: number } = note ? { version, head: note.head, body: note.body } : { version };
    if (this.busy) {
      // the save in the air is either this very version or will be refused for it
      if (!this.announced || version >= this.announced.version) this.announced = told;
      return;
    }
    this.busy = (async () => {
      try {
        if (!(await this.pull(told))) {
          // a word is being composed on the page: shown as soon as it is done
          if (!this.announced || version >= this.announced.version) this.announced = told;
          this.showLater();
          return;
        }
        if (this.closed) return;
        if (this.dirty) {
          this.set("unsaved");
          this.schedule(0);
        } else if (this.state !== "failed") this.set("saved");
      } catch (err) {
        // the note is still what it was here; the next save or event tries again
        if (this.deps.kind(err) === "offline") this.set(this.dirty ? "offline" : this.state, err);
      }
    })().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private showLater(): void {
    if (this.showTimer || this.closed) return;
    this.showTimer = setTimeout(() => {
      this.showTimer = null;
      const waiting = this.takeAnnounced();
      if (waiting) void this.remote(waiting.version, "head" in waiting ? waiting : undefined);
    }, SHOW_AGAIN);
  }

  /**
   * Puts an earlier state of the note back. The page shows it, and the save
   * that carries it sets the state it replaces aside as a version, so putting
   * something back never loses what was there. False when the page could not
   * show it just now.
   */
  async restore(doc: NoteDoc): Promise<boolean> {
    if (this.closed) return false;
    // what is on the page is saved first, so it is in the history too
    await this.flush();
    if (this.closed || this.state === "failed" || this.state === "offline") return false;
    if (sameDoc(doc, this.doc)) return true;
    if (!this.events.onRemote(doc)) return false;
    this.keep = true;
    this.doc = doc;
    this.set("unsaved");
    await this.flush();
    return (this.state as SaveState) !== "failed" && (this.state as SaveState) !== "offline";
  }

  /** Tries again after a save that was refused, with whatever the note says now. */
  retry(): Promise<void> {
    if (this.dirty) this.set("unsaved");
    return this.flush();
  }

  /** Stops saving. Whatever is unsaved is the caller's to flush first. */
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.showTimer) clearTimeout(this.showTimer);
    this.timer = null;
    this.showTimer = null;
  }
}
