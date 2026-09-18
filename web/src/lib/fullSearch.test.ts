/**
 * The walk through history, without a server.
 *
 * Everything the scan touches outside itself is injected, so these exercise the
 * parts that are easy to get wrong and impossible to see: the paging cursors,
 * the order pages are asked for in, what the session index saves on a second
 * search, and what happens when the server says no.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Message } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";
import {
  backoffFor,
  clearSearchIndex,
  indexStats,
  MAX_INDEXED_BYTES,
  MAX_INDEXED_MESSAGES,
  pageIsAllLocked,
  pickNext,
  scanEverything,
  type ScanChannel,
  type ScanDeps,
  type ScanProgress,
} from "./fullSearch";
import { parseQuery } from "./search";

const PAGE = 100;

function mk(channel: string, id: number, text: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: String(id),
    channel_id: channel,
    author_id: "u1",
    type: "default",
    ciphertext: null,
    key_conv_id: "conv",
    key_epoch: 1,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: id,
    payload: { t: text },
    ...extra,
  };
}

/** A conversation's whole history, oldest first, as the store would hold it. */
function history(channel: string, count: number, text: (i: number) => string, from = 1): DecryptedMessage[] {
  return Array.from({ length: count }, (_, i) => mk(channel, from + i, text(i)));
}

/** The same history, from before the reader held a key for it. */
function unreadable(msgs: DecryptedMessage[]): DecryptedMessage[] {
  return msgs.map((m) => {
    const out: DecryptedMessage = { ...m, decryptError: "no_key" };
    delete out.payload;
    return out;
  });
}

interface Fake {
  deps: Partial<ScanDeps>;
  /** Every (channel, query) asked for, in order. */
  calls: { channel: string; before?: string; after?: string }[];
  sleeps: number[];
}

/** A server holding the given histories, with an instant clock that still paces. */
function fakeServer(store: Record<string, DecryptedMessage[]>, opts: { fail?: Record<string, unknown> } = {}): Fake {
  const calls: Fake["calls"] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const plain = new Map<string, DecryptedMessage>();
  for (const msgs of Object.values(store)) for (const m of msgs) plain.set(m.id, m);

  const deps: Partial<ScanDeps> = {
    list: async (channel, q) => {
      calls.push({ channel, ...(q.before !== undefined ? { before: q.before } : {}), ...(q.after !== undefined ? { after: q.after } : {}) });
      const fail = opts.fail?.[channel];
      if (fail) throw fail;
      const all = store[channel] ?? [];
      const strip = (m: DecryptedMessage): Message => {
        const { payload: _p, decryptError: _d, ...rest } = m;
        return rest;
      };
      if (q.after !== undefined) return all.filter((m) => Number(m.id) > Number(q.after)).slice(0, PAGE).map(strip);
      const below = q.before === undefined ? all : all.filter((m) => Number(m.id) < Number(q.before));
      return below.slice(-PAGE).map(strip);
    },
    decrypt: async (m) => plain.get(m.id) ?? { ...m },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

function run(store: Record<string, DecryptedMessage[]>, query: string, over: ScanChannel[], extra: Partial<ScanDeps> = {}, fail?: Record<string, unknown>) {
  const fake = fakeServer(store, fail ? { fail } : {});
  const hits: DecryptedMessage[] = [];
  const ctrl = new AbortController();
  let last: ScanProgress | null = null;
  const done = scanEverything({
    query: parseQuery(query),
    ctx: { users: {}, channelNames: { c1: "general", c2: "random" } },
    channels: over,
    onHit: (m) => hits.push(...m),
    onProgress: (p) => {
      last = p;
    },
    signal: ctrl.signal,
    deps: { ...fake.deps, ...extra },
  });
  return { fake, hits, ctrl, done, progress: () => last };
}

/** The newest id a conversation holds, as the channel list would report it. */
function chan(store: Record<string, DecryptedMessage[]>, id: string): ScanChannel {
  const all = store[id] ?? [];
  return { id, lastMessageId: all.length ? all[all.length - 1]!.id : null };
}

beforeEach(() => clearSearchIndex());

describe("paging helpers", () => {
  it("picks the conversation whose next page is newest", () => {
    expect(pickNext(new Map([["a", "90"], ["b", "1000"], ["c", "200"]]))).toBe("b");
    expect(pickNext(new Map())).toBeNull();
  });

  it("recognises a page nobody holds a key for", () => {
    expect(pageIsAllLocked([])).toBe(false);
    expect(pageIsAllLocked([mk("c1", 1, "", { decryptError: "no_key" })])).toBe(true);
    expect(pageIsAllLocked([mk("c1", 1, "", { decryptError: "no_key" }), mk("c1", 2, "hi")])).toBe(false);
  });

  it("waits as long as the server asked, and no longer than the ceiling", () => {
    expect(backoffFor(new ApiError(429, "rate_limited", "", 7), 0)).toBe(7_000);
    expect(backoffFor(new ApiError(429, "rate_limited", ""), 0)).toBe(1_000);
    expect(backoffFor(new ApiError(429, "rate_limited", ""), 3)).toBe(8_000);
    expect(backoffFor(new ApiError(429, "rate_limited", "", 600), 0)).toBe(30_000);
  });
});

describe("walking history", () => {
  it("pages back to the start of a conversation and matches as it goes", async () => {
    const store = { c1: history("c1", 250, (i) => (i % 50 === 0 ? "needle here" : "hay")) };
    const { hits, done, fake, progress } = run(store, "needle", [chan(store, "c1")]);
    const final = await done;
    expect(final.running).toBe(false);
    expect(hits).toHaveLength(5);
    // Newest first: the walk starts at the top of the conversation.
    expect(Number(hits[0]!.id)).toBeGreaterThan(Number(hits[4]!.id));
    expect(final.messages).toBe(250);
    expect(final.channelsDone).toBe(1);
    expect(final.unreadable).toBe(0);
    // Three pages: 100, 100, 50 — and the last is short, so no fourth is asked for.
    expect(fake.calls).toHaveLength(3);
    expect(progress()?.running).toBe(false);
  });

  it("keeps the query's filters", async () => {
    const store = {
      c1: history("c1", 3, () => "shared word"),
      c2: history("c2", 3, () => "shared word", 100),
    };
    const { hits, done } = run(store, "shared in:random", [chan(store, "c1"), chan(store, "c2")]);
    await done;
    expect(hits.map((m) => m.channel_id)).toEqual(["c2", "c2", "c2"]);
  });

  it("interleaves conversations so the newest messages anywhere come first", async () => {
    // c1 holds the newest ids, c2 the oldest, and each needs two pages.
    const store = {
      c1: history("c1", 150, () => "needle", 1_000),
      c2: history("c2", 150, () => "needle", 1),
    };
    const { hits, fake, done } = run(store, "needle", [chan(store, "c1"), chan(store, "c2")]);
    await done;
    expect(hits).toHaveLength(300);
    // c1's pages are asked for first because its cursor is higher, and only
    // once it drops below c2's does c2 get a turn.
    expect(fake.calls.map((c) => c.channel)).toEqual(["c1", "c1", "c2", "c2"]);
  });

  it("stops walking once a whole page predates after:", async () => {
    const DAY = 86_400_000;
    const at = (i: number) => Date.parse("2026-01-01T12:00:00Z") + i * DAY;
    const ymd = (ms: number): string => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const store = { c1: Array.from({ length: 450 }, (_, i) => mk("c1", i + 1, "needle", { created_at: at(i + 1) })) };
    const { hits, fake, done } = run(store, `needle after:${ymd(at(199))}`, [chan(store, "c1")]);
    await done;
    expect(hits).toHaveLength(251);
    // Four pages: three that still hold matches, and the first that is wholly
    // too old. The hundred below it are never fetched.
    expect(fake.calls).toHaveLength(4);
  });

  it("paces its requests so the rate limiter never sees a burst", async () => {
    const store = { c1: history("c1", 250, () => "needle") };
    const { fake, done } = run(store, "needle", [chan(store, "c1")]);
    await done;
    // The first request goes out at once; every one after it waits the gap.
    expect(fake.sleeps).toEqual([200, 200]);
  });
});

describe("the session index", () => {
  it("searches again without fetching anything twice", async () => {
    const store = { c1: history("c1", 150, (i) => (i === 0 ? "alpha" : "beta")) };
    const first = run(store, "alpha", [chan(store, "c1")]);
    await first.done;
    expect(first.hits).toHaveLength(1);
    expect(first.fake.calls).toHaveLength(2);
    expect(indexStats().messages).toBe(150);

    const second = run(store, "beta", [chan(store, "c1")]);
    const final = await second.done;
    expect(second.fake.calls).toHaveLength(0);
    expect(second.hits).toHaveLength(149);
    expect(final.messages).toBe(150);
  });

  it("fetches only what arrived since the last search", async () => {
    const store = { c1: history("c1", 50, () => "needle") };
    await run(store, "needle", [chan(store, "c1")]).done;
    store["c1"] = store["c1"]!.concat(history("c1", 3, () => "needle", 51));

    const again = run(store, "needle", [chan(store, "c1")]);
    const final = await again.done;
    // One request, forward from the newest message the index already held.
    expect(again.fake.calls).toEqual([{ channel: "c1", after: "50" }]);
    expect(final.messages).toBe(53);
    expect(again.hits).toHaveLength(53);
  });

  it("takes what the chat view already decrypted instead of fetching it", async () => {
    const store = { c1: history("c1", 40, () => "needle") };
    const seed = (id: string) => (id === "c1" ? { msgs: store["c1"]!, reachedStart: true } : null);
    const { fake, hits, done } = run(store, "needle", [chan(store, "c1")], { seed });
    const final = await done;
    expect(fake.calls).toHaveLength(0);
    expect(hits).toHaveLength(40);
    expect(final.channelsDone).toBe(1);
  });

  it("forgets everything when the keys go", async () => {
    const store = { c1: history("c1", 20, () => "needle") };
    await run(store, "needle", [chan(store, "c1")]).done;
    expect(indexStats().messages).toBe(20);
    clearSearchIndex();
    expect(indexStats()).toMatchObject({ messages: 0, channels: 0, bytes: 0 });
  });

  it("keeps a whole conversation when it fits", async () => {
    const store = { c1: history("c1", 300, () => "needle") };
    const { done } = run(store, "needle", [chan(store, "c1")]);
    await done;
    expect(indexStats().messages).toBe(300);
    expect(MAX_INDEXED_MESSAGES).toBeGreaterThan(300);
  });

  it("stops reaching further back once it is full, and says so", async () => {
    // One long message repeated: the same string by reference, so this weighs
    // what a busy year of history weighs without allocating it.
    const long = "x".repeat(250_000);
    const store = { c1: history("c1", 250, () => long) };
    const { fake, done } = run(store, "x", [chan(store, "c1")]);
    const final = await done;
    expect(final.capped).toBe(true);
    expect(indexStats().bytes).toBeGreaterThan(MAX_INDEXED_BYTES);
    // The first page filled it; nothing older was asked for.
    expect(fake.calls).toHaveLength(1);
  });

  it("still takes in what has just arrived after it is full", async () => {
    const long = "x".repeat(250_000);
    const store: Record<string, DecryptedMessage[]> = { c1: history("c1", 250, () => long) };
    await run(store, "x", [chan(store, "c1")]).done;
    expect(indexStats().bytes).toBeGreaterThan(MAX_INDEXED_BYTES);

    store["c1"] = store["c1"]!.concat([mk("c1", 999, "a fresh needle")]);
    const again = run(store, "needle", [chan(store, "c1")]);
    const final = await again.done;
    // A full index must not mean a search that has stopped seeing today.
    expect(again.fake.calls).toEqual([{ channel: "c1", after: "250" }]);
    expect(again.hits.map((m) => m.id)).toEqual(["999"]);
    expect(final.capped).toBe(true);
  });
});

describe("conversations that cannot be read", () => {
  it("counts a conversation the server refuses and carries on with the rest", async () => {
    const store = { c1: history("c1", 10, () => "needle"), c2: history("c2", 10, () => "needle", 100) };
    const { hits, done } = run(store, "needle", [chan(store, "c1"), chan(store, "c2")], {}, { c1: new ApiError(403, "forbidden", "no") });
    const final = await done;
    expect(final.unreadable).toBe(1);
    expect(final.channelsDone).toBe(2);
    expect(hits.map((m) => m.channel_id)).toEqual(Array(10).fill("c2"));
  });

  it("counts a conversation this device holds no key for, without paging through it", async () => {
    const store = { c1: unreadable(history("c1", 250, () => "needle")) };
    const { fake, done } = run(store, "needle", [chan(store, "c1")]);
    const final = await done;
    expect(final.unreadable).toBe(1);
    // One page was enough to know the rest is unreadable too.
    expect(fake.calls).toHaveLength(1);
  });

  it("stops at the grant that let this reader in, and does not call it unreadable", async () => {
    // The newest 120 messages decrypt; the 200 before the grant do not.
    const readable = history("c1", 120, () => "needle", 201);
    const locked = unreadable(history("c1", 200, () => "needle"));
    const store = { c1: locked.concat(readable) };
    const { hits, fake, done } = run(store, "needle", [chan(store, "c1")]);
    const final = await done;
    expect(final.unreadable).toBe(0);
    expect(hits).toHaveLength(120);
    // A page of plaintext, a page straddling the grant, then a page that is
    // nothing but locked messages — and the walk stops there rather than
    // spending four more pages proving the same thing.
    expect(fake.calls.map((c) => c.before)).toEqual(["321", "221", "121"]);
  });

  it("waits out a rate limit and then carries on", async () => {
    const store = { c1: history("c1", 10, () => "needle") };
    const fake = fakeServer(store);
    let refusals = 2;
    const list: ScanDeps["list"] = async (channel, q, sig) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new ApiError(429, "rate_limited", "slow down", 3);
      }
      return fake.deps.list!(channel, q, sig);
    };
    const hits: DecryptedMessage[] = [];
    const final = await scanEverything({
      query: parseQuery("needle"),
      ctx: { users: {}, channelNames: {} },
      channels: [chan(store, "c1")],
      onHit: (m) => hits.push(...m),
      onProgress: () => {},
      signal: new AbortController().signal,
      deps: { ...fake.deps, list },
    });
    expect(hits).toHaveLength(10);
    expect(final.throttled).toBe(false);
    // Two Retry-After waits of three seconds, plus the pacing gaps around them.
    expect(fake.sleeps.filter((ms) => ms === 3_000)).toHaveLength(2);
  });

  it("gives up on a conversation that keeps refusing", async () => {
    const store = { c1: history("c1", 10, () => "needle"), c2: history("c2", 10, () => "needle", 100) };
    const { done } = run(store, "needle", [chan(store, "c1"), chan(store, "c2")], {}, { c1: new ApiError(500, "server_error", "boom") });
    const final = await done;
    expect(final.unreadable).toBe(1);
    expect(final.channelsDone).toBe(2);
  });
});

describe("cancelling", () => {
  it("stops where it is and never fetches again", async () => {
    const store = { c1: history("c1", 1_000, () => "needle") };
    const fake = fakeServer(store);
    const ctrl = new AbortController();
    const hits: DecryptedMessage[] = [];
    let pages = 0;
    const list: ScanDeps["list"] = async (channel, q, sig) => {
      pages += 1;
      if (pages === 2) ctrl.abort();
      return fake.deps.list!(channel, q, sig);
    };
    const final = await scanEverything({
      query: parseQuery("needle"),
      ctx: { users: {}, channelNames: {} },
      channels: [chan(store, "c1")],
      onHit: (m) => hits.push(...m),
      onProgress: () => {},
      signal: ctrl.signal,
      deps: { ...fake.deps, list },
    });
    expect(pages).toBe(2);
    expect(final.running).toBe(false);
    // A cancelled walk keeps what it found rather than throwing it away.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(1_000);
  });

  it("does nothing at all when it starts already cancelled", async () => {
    const store = { c1: history("c1", 100, () => "needle") };
    const ctrl = new AbortController();
    ctrl.abort();
    const fake = fakeServer(store);
    const onHit = vi.fn();
    const final = await scanEverything({
      query: parseQuery("needle"),
      ctx: { users: {}, channelNames: {} },
      channels: [chan(store, "c1")],
      onHit,
      onProgress: () => {},
      signal: ctrl.signal,
      deps: fake.deps,
    });
    expect(fake.calls).toHaveLength(0);
    expect(onHit).not.toHaveBeenCalled();
    expect(final.running).toBe(false);
  });
});

describe("conversations with nothing in them", () => {
  it("never asks for a conversation that has no messages", async () => {
    const { fake, done } = run({}, "needle", [{ id: "c9", lastMessageId: null }]);
    const final = await done;
    expect(fake.calls).toHaveLength(0);
    expect(final.channelsDone).toBe(1);
    expect(final.unreadable).toBe(0);
  });
});
