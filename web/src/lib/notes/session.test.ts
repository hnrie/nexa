import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMeta } from "@/crypto/message";
import type { NoteDoc } from "./model";
import { NoteSession, type SaveState, type SessionDeps } from "./session";

/** A pretend server holding one note, sealed only in name: what was sent is kept as JSON. */
class FakeServer {
  version = 1;
  head = JSON.stringify({ title: "Plan", preview: "first line\n", files: {} });
  body = JSON.stringify({ md: "first line\n", files: {} });
  files: string[] = [];
  /** Which saves asked for the state they replaced to be kept as a version. */
  kept: number[] = [];
  /** Blobs the server will not take: a save naming one is refused, and told which. */
  gone: string[] = [];
  saves = 0;
  offline = false;
  refuse: unknown = null;
  /** Called between a save arriving and its answer, to slip another save in. */
  during: (() => void) | null = null;

  deps(over: Partial<SessionDeps> = {}): SessionDeps {
    return {
      save: async (head, body, base, files, keep) => {
        if (this.offline) throw new Error("offline");
        if (this.refuse) throw this.refuse;
        const during = this.during;
        this.during = null;
        during?.();
        if (base !== this.version) throw new Error("stale");
        const missing = files.filter((f) => this.gone.includes(f));
        if (missing.length > 0) throw Object.assign(new Error("files"), { files: missing });
        if (keep) this.kept.push(this.version);
        this.version += 1;
        this.head = head;
        this.body = body;
        this.files = files;
        this.saves += 1;
        return { version: this.version };
      },
      fetch: async () => {
        if (this.offline) throw new Error("offline");
        return { version: this.version, head: this.head, body: this.body };
      },
      seal: async (_part, value) => JSON.stringify(value),
      open: async (_part, sealed) => JSON.parse(sealed) as unknown,
      kind: (err) => (err instanceof Error && (err.message === "stale" || err.message === "offline") ? err.message : "other"),
      delay: 1000,
      maxDelay: 5000,
      retry: 3000,
      ...over,
    };
  }

  /** Someone else's save, straight onto the server. */
  write(md: string, title = "Plan"): void {
    this.version += 1;
    this.head = JSON.stringify({ title, preview: md, files: {} });
    this.body = JSON.stringify({ md, files: {} });
  }

  get md(): string {
    return (JSON.parse(this.body) as { md: string }).md;
  }
  get title(): string {
    return (JSON.parse(this.head) as { title: string }).title;
  }
}

function open(server: FakeServer, over: Partial<SessionDeps> = {}) {
  const states: SaveState[] = [];
  const shown: NoteDoc[] = [];
  const doc: NoteDoc = { title: server.title, md: server.md, files: {} };
  /** Whether the page can swap its text right now; a word being composed makes it false. */
  const page = { ready: true };
  const session = new NoteSession(
    server.deps(over),
    { version: server.version, doc },
    {
      onState: (s) => states.push(s),
      onRemote: (d) => {
        if (page.ready) shown.push(d);
        return page.ready;
      },
    },
  );
  return { session, states, shown, page };
}

const picture = (blob: string, copy?: string): AttachmentMeta => ({ blob_id: blob, name: "p.png", type: "image/png", size: 10, key: "a2V5", ...(copy ? { preview: { blob_id: copy, key: "a2V5", size: 5, type: "image/webp", w: 10, h: 10 } } : {}) });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a note saving itself", () => {
  it("saves a moment after the typing pauses, once for a burst of changes", async () => {
    const server = new FakeServer();
    const { session, states } = open(server);
    session.edit({ md: "first line\nsecond" });
    session.edit({ md: "first line\nsecond line" });
    expect(states).toEqual(["unsaved"]);
    await vi.advanceTimersByTimeAsync(900);
    session.edit({ md: "first line\nsecond line!" });
    await vi.advanceTimersByTimeAsync(900);
    expect(server.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(server.saves).toBe(1);
    expect(server.md).toBe("first line\nsecond line!");
    expect(session.version).toBe(2);
    expect(states).toEqual(["unsaved", "saving", "saved"]);
  });

  it("does not wait for a pause that never comes", async () => {
    const server = new FakeServer();
    const { session } = open(server);
    for (let i = 0; i < 12; i++) {
      session.edit({ md: `typing ${i}` });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(server.saves).toBeGreaterThanOrEqual(1);
  });

  it("sends nothing for a change that was undone, and nothing when nothing changed", async () => {
    const server = new FakeServer();
    const { session, states } = open(server);
    session.edit({ md: "something else" });
    session.edit({ md: "first line\n" });
    await vi.advanceTimersByTimeAsync(5000);
    await session.flush();
    expect(server.saves).toBe(0);
    expect(states[states.length - 1]).toBe("saved");
  });

  it("saves what was typed while a save was in the air, straight after", async () => {
    const server = new FakeServer();
    const { session } = open(server);
    session.edit({ md: "one" });
    server.during = () => session.edit({ md: "one two" });
    await session.flush();
    expect(server.md).toBe("one two");
    expect(server.saves).toBe(2);
    expect(session.state).toBe("saved");
  });

  it("names the note's title and first lines in its head, and only the files its text still shows", async () => {
    const server = new FakeServer();
    const { session } = open(server);
    session.edit({ title: "  Trip  plan ", md: "![p.png](nexa-file:a)\nwords", files: { a: picture("111", "112"), gone: picture("999") } });
    await session.flush();
    expect(JSON.parse(server.head)).toMatchObject({ title: "Trip plan", preview: "![p.png](nexa-file:a)\nwords" });
    expect(Object.keys((JSON.parse(server.body) as { files: object }).files)).toEqual(["a"]);
    // the picture and its small copy are the note's on the server; the file nothing shows is not
    expect(server.files).toEqual(["111", "112"]);
  });
});

describe("two people in one note", () => {
  it("puts both their changes together when one saves over the other", async () => {
    const server = new FakeServer();
    server.write("title\n\nalpha\n\nbeta\n");
    const mine = open(server);
    // someone else adds a line at the end and saves first
    server.write("title\n\nalpha\n\nbeta\n\ngamma, from them\n");
    mine.session.edit({ md: "title\n\nalpha, edited by me\n\nbeta\n" });
    await mine.session.flush();
    expect(server.md).toBe("title\n\nalpha, edited by me\n\nbeta\n\ngamma, from them\n");
    // and the page was shown the merged note, so the editor is not left behind
    expect(mine.shown).toHaveLength(1);
    expect(mine.shown[0]?.md).toBe(server.md);
    expect(mine.session.state).toBe("saved");
    expect(mine.session.version).toBe(server.version);
  });

  it("takes in a change announced while the note is just open, without saving anything", async () => {
    const server = new FakeServer();
    const { session, shown } = open(server);
    server.write("first line\nand a second, from them\n", "Plan B");
    await session.remote(server.version);
    expect(shown).toEqual([{ title: "Plan B", md: "first line\nand a second, from them\n", files: {} }]);
    expect(server.saves).toBe(0);
    expect(session.dirty).toBe(false);
    // the same announcement again, or an older one, is nothing new
    await session.remote(server.version);
    await session.remote(1);
    expect(shown).toHaveLength(1);
  });

  it("merges an announced change with words not saved yet, and saves the two", async () => {
    const server = new FakeServer();
    server.write("a\nb\nc\n");
    const { session, shown } = open(server);
    session.edit({ md: "a\nb\nc\nmine\n" });
    server.write("theirs\na\nb\nc\n");
    await session.remote(server.version);
    expect(shown[0]?.md).toBe("theirs\na\nb\nc\nmine\n");
    await vi.advanceTimersByTimeAsync(10);
    expect(server.md).toBe("theirs\na\nb\nc\nmine\n");
  });

  it("is told nothing when what the other wrote is what this page already has", async () => {
    const server = new FakeServer();
    const { session, shown } = open(server);
    session.edit({ md: "the same words\n" });
    server.write("the same words\n");
    await session.remote(server.version);
    expect(shown).toHaveLength(0);
    expect(session.dirty).toBe(false);
    expect(session.state).toBe("saved");
  });

  it("keeps a title this person changed, and takes theirs when this person did not", async () => {
    const server = new FakeServer();
    const mine = open(server);
    mine.session.edit({ title: "My title" });
    server.write("first line\n", "Their title");
    await mine.session.flush();
    expect(server.title).toBe("My title");

    const other = open(server);
    other.session.edit({ md: "first line\nmore\n" });
    server.write("first line\n", "Renamed by them");
    await other.session.flush();
    expect(server.title).toBe("Renamed by them");
    expect(other.shown[0]?.title).toBe("Renamed by them");
  });

  it("two sessions typing in turns end up with the same note, with everything both wrote", async () => {
    const server = new FakeServer();
    const a = open(server);
    const b = open(server);
    const tell = async () => {
      await a.session.remote(server.version);
      await b.session.remote(server.version);
    };
    a.session.edit({ md: a.session.doc.md + "A1\n" });
    b.session.edit({ md: "B1\n" + b.session.doc.md });
    await a.session.flush();
    await b.session.flush();
    await tell();
    a.session.edit({ md: a.session.doc.md.replace("first line", "first line (A2)") });
    b.session.edit({ md: b.session.doc.md + "B2\n" });
    await b.session.flush();
    await a.session.flush();
    await tell();
    expect(a.session.doc.md).toBe(b.session.doc.md);
    expect(a.session.doc.md).toBe(server.md);
    for (const piece of ["A1", "B1", "(A2)", "B2", "first line"]) expect(server.md).toContain(piece);
  });

  it("takes in a change the server sent along, without fetching it", async () => {
    const server = new FakeServer();
    let fetched = 0;
    const real = server.deps();
    const { session, shown } = open(server, {
      fetch: async () => {
        fetched += 1;
        return real.fetch();
      },
    });
    session.edit({ md: "first line\nmine\n" });
    server.write("theirs\nfirst line\n", "Plan");
    await session.remote(server.version, { head: server.head, body: server.body });
    expect(fetched).toBe(0);
    expect(shown[0]?.md).toBe("theirs\nfirst line\nmine\n");
    // one the server only announced, a long note, is fetched
    server.write("theirs\nfirst line\nmine\nand more\n");
    await session.remote(server.version);
    expect(fetched).toBe(1);
  });

  it("never swaps the page's text while a word is being composed, and shows the change once it is done", async () => {
    const server = new FakeServer();
    const { session, shown, page } = open(server);
    page.ready = false;
    session.edit({ md: "first line\ncomposing" });
    server.write("first line\ntheirs\n");
    await session.remote(server.version, { head: server.head, body: server.body });
    // nothing was shown, and nothing was taken in behind the page's back:
    // a save from here would otherwise undo what they wrote
    expect(shown).toHaveLength(0);
    expect(session.version).toBe(2 - 1);
    expect(session.doc.md).toBe("first line\ncomposing");
    page.ready = true;
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(50);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.md).toContain("theirs");
    expect(shown[0]?.md).toContain("composing");
    await session.flush();
    expect(server.md).toContain("theirs");
    expect(server.md).toContain("composing");
  });

  it("holds a save back, rather than save over theirs, when the page cannot show their change yet", async () => {
    const server = new FakeServer();
    const { session, page } = open(server);
    session.edit({ md: "first line\nmine" });
    server.write("first line\ntheirs\n");
    page.ready = false;
    await session.flush();
    // refused as stale, and not forced through
    expect(server.md).toBe("first line\ntheirs\n");
    expect(session.state).toBe("unsaved");
    page.ready = true;
    await vi.advanceTimersByTimeAsync(400);
    await session.flush();
    expect(server.md).toContain("theirs");
    expect(server.md).toContain("mine");
    expect(session.state).toBe("saved");
  });

  it("reads what the page holds this instant before putting a change into it", async () => {
    const server = new FakeServer();
    const states: SaveState[] = [];
    const shown: NoteDoc[] = [];
    // the page is a frame ahead of the last edit() the session was told of
    const session = new NoteSession(
      server.deps(),
      { version: server.version, doc: { title: server.title, md: server.md, files: {} } },
      { onState: (st) => states.push(st), onRemote: (d) => (shown.push(d), true), read: () => ({ md: "first line\ntyped a frame ago\n" }) },
    );
    server.write("theirs\nfirst line\n");
    await session.remote(server.version, { head: server.head, body: server.body });
    expect(shown[0]?.md).toBe("theirs\nfirst line\ntyped a frame ago\n");
  });

  it("waits for a save in the air before taking in an announced change", async () => {
    const server = new FakeServer();
    const { session } = open(server);
    session.edit({ md: "mine\n" });
    // their save lands first; ours is refused, merged, and sent again
    server.during = () => {
      server.write("first line\ntheirs\n");
      void session.remote(server.version);
    };
    await session.flush();
    expect(server.md).toContain("mine");
    expect(server.md).toContain("theirs");
    expect(session.version).toBe(server.version);
  });
});

describe("when a save cannot go through", () => {
  it("keeps the words and tries again while there is no connection", async () => {
    const server = new FakeServer();
    const { session, states } = open(server);
    server.offline = true;
    session.edit({ md: "written on a train\n" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(states[states.length - 1]).toBe("offline");
    expect(session.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(3100);
    expect(session.state).toBe("offline");
    server.offline = false;
    await vi.advanceTimersByTimeAsync(3100);
    expect(server.md).toBe("written on a train\n");
    expect(session.state).toBe("saved");
  });

  it("says so when the server refuses, and saves once asked again", async () => {
    const server = new FakeServer();
    const { session, states } = open(server);
    server.refuse = new Error("you can no longer edit this note");
    session.edit({ md: "more\n" });
    await session.flush();
    expect(states[states.length - 1]).toBe("failed");
    expect(session.error).toBe(server.refuse);
    // it does not hammer the server by itself
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.saves).toBe(0);
    server.refuse = null;
    await session.retry();
    expect(server.md).toBe("more\n");
    expect(session.state).toBe("saved");
  });

  it("gives up on a server that keeps saying the note moved on without showing a newer one", async () => {
    const server = new FakeServer();
    const { session } = open(server, {
      save: async () => {
        throw new Error("stale");
      },
    });
    session.edit({ md: "x\n" });
    await session.flush();
    expect(session.state).toBe("failed");
  });

  it("puts an earlier state back, keeping what it replaces as a version", async () => {
    const server = new FakeServer();
    const { session, shown } = open(server);
    session.edit({ md: "first line\nwritten since\n" });
    // not saved yet: restoring saves it first, so it is in the history too
    const ok = await session.restore({ title: "Plan", md: "as it was\n", files: {} });
    expect(ok).toBe(true);
    expect(server.saves).toBe(2);
    expect(server.md).toBe("as it was\n");
    // only the save that put the old state back asked for a version
    expect(server.kept).toEqual([2]);
    expect(shown[shown.length - 1]?.md).toBe("as it was\n");
    expect(session.state).toBe("saved");
    // and the next ordinary save does not ask again
    session.edit({ md: "as it was\nand on\n" });
    await session.flush();
    expect(server.kept).toEqual([2]);
  });

  it("does not put a state back while what is on the page cannot be saved", async () => {
    const server = new FakeServer();
    const { session, shown } = open(server);
    server.offline = true;
    session.edit({ md: "unsaved words\n" });
    expect(await session.restore({ title: "Plan", md: "as it was\n", files: {} })).toBe(false);
    expect(shown).toEqual([]);
    expect(session.doc.md).toBe("unsaved words\n");
  });

  it("saves without a file the server no longer has, and shows the note without it", async () => {
    const server = new FakeServer();
    const mend: SessionDeps["mend"] = (err, doc) => {
      const named = (err as { files?: string[] }).files;
      if (!named) return null;
      const files = { ...doc.files };
      let md = doc.md;
      for (const [id, meta] of Object.entries(doc.files)) {
        if (!named.includes(meta.blob_id)) continue;
        delete files[id];
        md = md.split("\n").filter((line) => !line.includes(`nexa-file:${id})`)).join("\n");
      }
      return md === doc.md ? null : { ...doc, md, files };
    };
    const { session, shown } = open(server, { mend });
    server.gone = ["222"];
    session.edit({ md: "first line\n![a.png](nexa-file:a)\n![b.png](nexa-file:b)\nlast\n", files: { a: picture("111"), b: picture("222") } });
    await session.flush();
    expect(session.state).toBe("saved");
    expect(server.md).toBe("first line\n![a.png](nexa-file:a)\nlast\n");
    expect(server.files).toEqual(["111"]);
    expect(shown[shown.length - 1]?.md).toBe("first line\n![a.png](nexa-file:a)\nlast\n");
  });

  it("does nothing more once it is closed", async () => {
    const server = new FakeServer();
    const { session, states } = open(server);
    session.edit({ md: "x\n" });
    session.close();
    await vi.advanceTimersByTimeAsync(10_000);
    session.edit({ md: "y\n" });
    await session.flush();
    expect(server.saves).toBe(0);
    expect(states).toEqual(["unsaved"]);
  });
});
