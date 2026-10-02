import { ApiError } from "@/api/client";
import { b64 } from "@/crypto/bytes";
import type { NoteDoc } from "./model";
import { NoteSession, type FailureKind, type SessionDeps } from "./session";
import { hasDoc } from "./ydoc";

/**
 * Several people's copies of one note against a pretend server: each change
 * is numbered, kept and passed on as the real one does, but the passing on
 * waits until the test lets it through, in whatever order the test likes, so
 * the changes can be made to cross every way they can on a real network.
 */

const plainSeal = (v: unknown) => `S:${JSON.stringify(v)}`;
const plainOpen = (s: string) => JSON.parse(s.slice(2)) as unknown;
const sealBytes = (u: Uint8Array) => `U:${b64.enc(u)}`;
const openBytes = (s: string) => b64.dec(s.slice(2));

const stale = () => new ApiError(409, "note_stale", "stale");
const offline = () => new ApiError(0, "network", "offline");
const kind = (err: unknown): FailureKind => {
  if (!(err instanceof ApiError)) return "other";
  if (err.code === "note_stale") return "stale";
  if (err.code === "note_rekeyed") return "rekeyed";
  if (err.code === "note_save_first") return "saveFirst";
  if (err.status === 0) return "offline";
  return "other";
};

interface Event {
  to: Page;
  ev: { seq: number; update?: string; cid: string };
}

class Server {
  version = 1;
  head: string;
  body: string;
  crdtSeq = 0;
  crdtUpto = 0;
  epoch = 0;
  log: { seq: number; update: string; cid: string }[] = [];
  pages: Page[] = [];
  pending: Event[] = [];
  down = false;
  constructor(start: { title: string; md: string; v2?: boolean }) {
    this.head = plainSeal({ title: start.title, preview: start.md, files: {} });
    this.body = plainSeal({ md: start.md, files: {} });
  }
  post(update: string, epoch: number, cid: string): { seq: number } {
    if (this.down) throw offline();
    if (epoch !== this.epoch) throw new ApiError(409, "note_rekeyed", "rekeyed");
    const seq = ++this.crdtSeq;
    this.log.push({ seq, update, cid });
    for (const p of this.pages) if (p.open) this.pending.push({ to: p, ev: { seq, update, cid } });
    return { seq };
  }
  save(head: string, body: string, base: number, upto: number): { version: number } {
    if (this.down) throw offline();
    if (base !== this.version || upto < this.crdtUpto) throw stale();
    if (upto > this.crdtSeq) throw new ApiError(400, "bad_note", "bad");
    this.version += 1;
    this.head = head;
    this.body = body;
    this.crdtUpto = upto;
    this.log = this.log.filter((u) => u.seq > upto);
    return { version: this.version };
  }
  changes(after: number) {
    if (this.down) throw offline();
    return { updates: this.log.filter((u) => u.seq > after).map(({ seq, update }) => ({ seq, update })), crdtUpto: this.crdtUpto, more: false };
  }
  /** Lets the waiting events through: in order, or shuffled, or all but some. */
  async deliver(opts: { shuffle?: boolean; drop?: (e: Event) => boolean } = {}): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (opts.shuffle) batch.sort(() => Math.random() - 0.5);
    for (const e of batch) if (!opts.drop?.(e) && e.to.open) await e.to.session.remote(e.ev, e.to.cid);
    await settle();
  }
}

/** One person's page with the note open: what the editor shows, and the session behind it. */
class Page {
  shown: NoteDoc;
  /** Where this page's caret is in the note's text, as an editor would say it. */
  caretAt: number | null = null;
  composing = false;
  open = true;
  session: NoteSession;
  cid: string;
  states: string[] = [];
  constructor(
    readonly server: Server,
    readonly name: string,
    opts: { unsent?: Uint8Array | null; deps?: Partial<SessionDeps> } = {},
  ) {
    this.cid = `${name}-${Math.random().toString(36).slice(2, 8)}`;
    server.pages.push(this);
    const head = plainOpen(server.head) as { title: string };
    const deps: SessionDeps = {
      send: async (update) => server.post(sealBytes(update), server.epoch, this.cid),
      changes: async (after) => server.changes(after),
      openUpdate: async (s) => openBytes(s),
      save: async (h, b, base, _files, upto) => server.save(h, b, base, upto),
      fetch: async () => {
        if (server.down) throw offline();
        return { version: server.version, head: server.head, body: server.body, crdtUpto: server.crdtUpto };
      },
      seal: async (_part, v) => plainSeal(v),
      open: async (_part, s) => plainOpen(s),
      kind,
      sendDelay: 0,
      sendMax: 0,
      saveIdle: 10_000_000,
      saveMax: 10_000_000,
      retry: 5,
      ...opts.deps,
    };
    this.session = new NoteSession(
      deps,
      { noteId: "note-1", version: server.version, title: head.title, body: plainOpen(server.body), crdtUpto: server.crdtUpto, unsent: opts.unsent ?? null },
      {
        onState: (s) => this.states.push(s),
        onRemote: (doc, at) => {
          if (this.composing) return false;
          this.shown = doc;
          if (at?.md !== undefined && at.md !== null) this.caretAt = at.md;
          return true;
        },
        read: () => ({ md: this.shown.md, title: this.shown.title }),
        canShow: () => !this.composing,
        caret: () => ({ md: this.caretAt, title: null }),
      },
    );
    this.shown = this.session.doc;
    void this.session.catchUp();
  }
  /** Types text at a place in the note, as the editor reports it: the whole note after the keystrokes. */
  type(at: number, text: string): void {
    const md = this.shown.md;
    this.shown = { ...this.shown, md: md.slice(0, at) + text + md.slice(at) };
    this.session.edit({ md: this.shown.md });
  }
  /** Types where the caret is, moving it along as an editor does. */
  typeAtCaret(text: string): void {
    const at = this.caretAt ?? this.shown.md.length;
    this.type(at, text);
    this.caretAt = at + text.length;
  }
  /** Types one character at a time, each reported as the editor would. */
  typeSlowly(at: number, text: string): void {
    for (let i = 0; i < text.length; i++) this.type(at + i, text[i]!);
  }
  erase(at: number, count: number): void {
    const md = this.shown.md;
    this.shown = { ...this.shown, md: md.slice(0, at) + md.slice(at + count) };
    this.session.edit({ md: this.shown.md });
  }
  title(text: string): void {
    this.shown = { ...this.shown, title: text };
    this.session.edit({ title: text });
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 1));
}

/** Lets everything settle: changes sent, passed on and taken in, until nothing more moves. */
async function sync(server: Server, opts: { shuffle?: boolean } = {}): Promise<void> {
  for (let round = 0; round < 10; round++) {
    await settle();
    if (server.pending.length === 0) {
      await settle();
      if (server.pending.length === 0) return;
    }
    await server.deliver(opts);
  }
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("a note written together", () => {
  it("keeps both people's words when they type in the same sentence at the same moment", async () => {
    const server = new Server({ title: "Plan", md: "We leave on Friday." });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    await sync(server);
    // both type at the very same place before either hears of the other
    alice.type(18, " at nine");
    bob.type(18, " by train");
    await sync(server);
    expect(alice.shown.md).toBe(bob.shown.md);
    expect(count(alice.shown.md, " at nine")).toBe(1);
    expect(count(alice.shown.md, " by train")).toBe(1);
    expect(count(alice.shown.md, "We leave on Friday")).toBe(1);
    expect(alice.shown.md.endsWith(".")).toBe(true);
  });

  it("puts three people's fast typing together the same way everywhere, however it crosses", async () => {
    const server = new Server({ title: "Ideas", md: "Start\nEnd" });
    const people = ["ann", "ben", "cat"].map((n) => new Page(server, n));
    await sync(server);
    // everyone types a word a letter at a time, all on the same line, while the others' letters arrive in any order
    const words = ["apples ", "boats ", "candles "];
    for (let i = 0; i < 8; i++) {
      people.forEach((p, k) => {
        const word = words[k]!;
        if (i < word.length) {
          // the end of the first line, where each of them has the caret
          const at = p.shown.md.indexOf("\nEnd");
          p.type(at, word[i]!);
        }
      });
      await settle();
      await server.deliver({ shuffle: true });
    }
    await sync(server, { shuffle: true });
    const md = people[0]!.shown.md;
    for (const p of people) expect(p.shown.md).toBe(md);
    // every letter once: nothing doubled, nothing lost
    expect(md.length).toBe("Start\nEnd".length + words.join("").length);
    expect(md.startsWith("Start")).toBe(true);
    expect(md.endsWith("\nEnd")).toBe(true);
    for (const w of words) for (const ch of w.trim()) expect(count(md, ch)).toBeGreaterThanOrEqual(1);
  });

  it("keeps each person's words together when they type letter by letter at the very same spot", async () => {
    for (let round = 0; round < 8; round++) {
      const server = new Server({ title: "Plan", md: "We leave on Friday\nBring snacks" });
      const alice = new Page(server, "alice");
      const bob = new Page(server, "bob");
      await sync(server);
      alice.caretAt = 18;
      bob.caretAt = 18;
      const a = " at nine";
      const b = " by train";
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length) alice.typeAtCaret(a[i]!);
        if (i < b.length) bob.typeAtCaret(b[i]!);
        await settle();
        // the others' letters arrive in a different order each round
        await server.deliver({ shuffle: round % 2 === 1 });
      }
      await sync(server, { shuffle: true });
      expect(alice.shown.md).toBe(bob.shown.md);
      const line = alice.shown.md.split("\n")[0]!;
      expect([`We leave on Friday${a}${b}`, `We leave on Friday${b}${a}`]).toContain(line);
      expect(alice.shown.md.endsWith("\nBring snacks")).toBe(true);
    }
  });

  it("moves a caret past what is put in before it, and leaves it before what is put in at it", async () => {
    const { moveThrough } = await import("./session");
    expect(moveThrough(5, [{ retain: 2 }, { insert: "abc" }])).toBe(8);
    expect(moveThrough(5, [{ retain: 5 }, { insert: "abc" }])).toBe(5);
    expect(moveThrough(5, [{ retain: 1 }, { delete: 2 }])).toBe(3);
    expect(moveThrough(5, [{ retain: 3 }, { delete: 4 }])).toBe(3);
    expect(moveThrough(5, [{ retain: 7 }, { delete: 1 }])).toBe(5);
    expect(moveThrough(0, [{ insert: "x" }])).toBe(0);
  });

  it("does not double a note saved before notes were kept this way when two people open it at once", async () => {
    // an existing note: its body has text and no document
    const server = new Server({ title: "Old Note", md: "Line one\nLine two" });
    expect(hasDoc(plainOpen(server.body))).toBe(false);
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.type(8, " (edited)");
    bob.type(17, "!");
    await sync(server);
    expect(alice.shown.md).toBe("Line one (edited)\nLine two!");
    expect(bob.shown.md).toBe(alice.shown.md);
    // a third person opening it later, from the saved body and the changes since, reads the same
    const carol = new Page(server, "carol");
    await sync(server);
    expect(carol.shown.md).toBe(alice.shown.md);
    expect(carol.shown.title).toBe("Old Note");
  });

  it("puts two titles typed at once together", async () => {
    const server = new Server({ title: "Trip", md: "" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.title("Trip to the coast");
    bob.title("Summer Trip");
    await sync(server);
    expect(alice.shown.title).toBe(bob.shown.title);
    expect(alice.shown.title).toContain("to the coast");
    expect(alice.shown.title).toContain("Summer");
    expect(count(alice.shown.title, "Trip")).toBe(1);
  });

  it("saves the whole note, lets the changes it holds go, and opens from it the same", async () => {
    const server = new Server({ title: "Shopping", md: "milk" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.type(4, ", eggs");
    bob.type(0, "- ");
    await sync(server);
    await alice.session.save({ force: true });
    expect(server.version).toBe(2);
    expect(server.crdtUpto).toBe(2);
    expect(server.log).toHaveLength(0);
    const body = plainOpen(server.body) as { md: string };
    expect(hasDoc(body)).toBe(true);
    expect(body.md).toBe("- milk, eggs");
    bob.type(12, ", bread");
    await sync(server);
    const later = new Page(server, "later");
    await sync(server);
    expect(later.shown.md).toBe("- milk, eggs, bread");
    expect(alice.shown.md).toBe(later.shown.md);
  });

  it("goes again over a save that crossed someone else's, with both in it", async () => {
    const server = new Server({ title: "Draft", md: "one" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.type(3, " two");
    bob.type(0, "zero ");
    // neither has heard of the other yet; both save the whole note
    await settle();
    await Promise.all([alice.session.save({ force: true }), bob.session.save({ force: true })]);
    await sync(server);
    expect(server.version).toBeGreaterThanOrEqual(3);
    const body = plainOpen(server.body) as { md: string };
    expect(body.md).toBe("zero one two");
    expect(alice.shown.md).toBe("zero one two");
    expect(bob.shown.md).toBe("zero one two");
  });

  it("keeps what is typed while offline, and sends it once the server answers again", async () => {
    const server = new Server({ title: "Notes", md: "a" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    server.down = true;
    alice.type(1, "bc");
    await settle();
    expect(alice.session.state).toBe("offline");
    expect(alice.session.dirty).toBe(true);
    server.down = false;
    await sync(server);
    await new Promise((r) => setTimeout(r, 20));
    await sync(server);
    expect(alice.session.state).toBe("saved");
    expect(bob.shown.md).toBe("abc");
  });

  it("puts changes left unsent back when the note is opened again", async () => {
    const server = new Server({ title: "Notes", md: "start" });
    const alice = new Page(server, "alice");
    server.down = true;
    alice.type(5, " and more");
    await settle();
    const left = alice.session.unsent();
    expect(left).not.toBeNull();
    alice.open = false;
    alice.session.close();
    server.down = false;
    const again = new Page(server, "alice-again", { unsent: left });
    await sync(server);
    expect(again.shown.md).toBe("start and more");
    expect(server.log.length).toBeGreaterThan(0);
    const bob = new Page(server, "bob");
    await sync(server);
    expect(bob.shown.md).toBe("start and more");
  });

  it("holds others' changes while a word is being composed, and loses nothing typed meanwhile", async () => {
    const server = new Server({ title: "Diary", md: "Today" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    bob.composing = true;
    alice.type(5, " was sunny");
    await sync(server);
    // not shown while composing
    expect(bob.shown.md).toBe("Today");
    // the word bob was composing lands
    bob.type(0, "Hi. ");
    bob.composing = false;
    await new Promise((r) => setTimeout(r, 400));
    await sync(server);
    expect(bob.shown.md).toBe("Hi. Today was sunny");
    expect(alice.shown.md).toBe(bob.shown.md);
  });

  it("asks for changes it never heard of, after a gap or a connection that was down", async () => {
    const server = new Server({ title: "Log", md: "" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.type(0, "first ");
    await settle();
    // bob's connection drops this one
    await server.deliver({ drop: (e) => e.to === bob });
    alice.type(6, "second");
    await settle();
    await server.deliver();
    // the gap is noticed and filled
    await new Promise((r) => setTimeout(r, 1400));
    await sync(server);
    expect(bob.shown.md).toBe("first second");
  });

  it("seals again with the note's new key when the old one is refused", async () => {
    const server = new Server({ title: "Secret", md: "x" });
    let fetched = 0;
    const alice = new Page(server, "alice", { deps: { rekeyed: async () => void (fetched += 1) } });
    const bob = new Page(server, "bob");
    // the note got a new key; alice's copy has not heard yet, so her first try is refused
    server.epoch = 1;
    let tries = 0;
    const realPost = server.post.bind(server);
    server.post = (u, _e, cid) => {
      tries += 1;
      return realPost(u, tries === 1 ? 0 : 1, cid);
    };
    alice.type(1, "y");
    await sync(server);
    expect(fetched).toBe(1);
    expect(bob.shown.md).toBe("xy");
  });

  it("shows a reader the changes as they are made", async () => {
    const server = new Server({ title: "News", md: "Hello" });
    const writer = new Page(server, "writer");
    const reader = new Page(server, "reader");
    writer.type(5, " everyone");
    await sync(server);
    expect(reader.shown.md).toBe("Hello everyone");
  });

  it("puts an earlier state back for everyone, keeping what it replaces as a version", async () => {
    const server = new Server({ title: "T", md: "old text" });
    const alice = new Page(server, "alice");
    const bob = new Page(server, "bob");
    alice.erase(0, 4);
    alice.type(0, "new ");
    await sync(server);
    expect(bob.shown.md).toBe("new text");
    const saves: number[] = [];
    const real = server.save.bind(server);
    server.save = (h, b, base, upto) => {
      saves.push(base);
      return real(h, b, base, upto);
    };
    expect(await alice.session.restore({ title: "T", md: "old text", files: {} })).toBe(true);
    await sync(server);
    expect(bob.shown.md).toBe("old text");
    expect(saves.length).toBeGreaterThan(0);
  });
});
