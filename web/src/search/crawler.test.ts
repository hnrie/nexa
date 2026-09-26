/**
 * The walk through history, without a server or a clock.
 *
 * Everything the crawler reaches is injected, so these check what matters and
 * cannot be seen from outside: which pages are asked for and in what order,
 * how far apart, what is saved to resume from, and what happens when the
 * server says no or there is no key.
 */
import { describe, expect, it } from "vitest";
import type { HistoryQuery } from "@/api/messages";
import { ApiError } from "@/api/client";
import type { Channel, Message } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";
import { Crawler, SLICE_PAGES, type CrawlState, type CrawlerOptions } from "./crawler";
import type { SearchDoc } from "./doc";
import { BACKGROUND_GAP_MS, PAGE, REQUEST_GAP_MS } from "./pacing";

function message(channel: string, id: number): Message {
  return { id: String(id), channel_id: channel, author_id: "u1", type: "default", ciphertext: null, key_conv_id: "k", key_epoch: 1, reply_to_id: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: id };
}

interface World {
  channels: Channel[];
  /** Every request, in order, with when it went. */
  calls: { channel: string; q: HistoryQuery; at: number }[];
  docs: Map<string, SearchDoc>;
  saved: CrawlState | null;
  crawler: Crawler;
  clock: { now: number };
  /** Fails the next request of a channel with this error. */
  fail: Map<string, unknown>;
  /** Ids whose messages have no key here. */
  locked: Set<string>;
  history: Map<string, number[]>;
  demand: (d: Set<string> | "all" | null) => void;
  /** The crawler said it was waiting out a refusal at some point. */
  throttleSeen: boolean;
}

/** Channels as [id, how many messages], newest activity first unless ids say otherwise. */
function world(spec: [string, number, number][], opts: Partial<CrawlerOptions> = {}, initial: CrawlState | null = null): World {
  const history = new Map<string, number[]>();
  const channels: Channel[] = [];
  for (const [id, count, base] of spec) {
    const ids = Array.from({ length: count }, (_, i) => base + i + 1);
    history.set(id, ids);
    channels.push({ id, type: "dm", last_message_id: count ? String(ids[ids.length - 1]) : null } as Channel);
  }
  const clock = { now: 1_000_000 };
  const w: Partial<World> = { channels, calls: [], docs: new Map(), saved: null, clock, fail: new Map(), locked: new Set(), history, throttleSeen: false };
  let self: Crawler | null = null;
  const crawler = new Crawler(
    {
      list: async (channel, q) => {
        w.calls!.push({ channel, q, at: clock.now });
        const f = w.fail!.get(channel);
        if (f) {
          w.fail!.delete(channel);
          throw f;
        }
        const all = history.get(channel) ?? [];
        if (q.after !== undefined) return all.filter((id) => id > Number(q.after)).slice(0, PAGE).map((id) => message(channel, id));
        const below = q.before === undefined ? all : all.filter((id) => id < Number(q.before));
        return below.slice(-PAGE).map((id) => message(channel, id));
      },
      decrypt: async (m) => (w.locked!.has(m.id) ? ({ ...m, decryptError: "no_key" } as DecryptedMessage) : ({ ...m, payload: { t: `message ${m.id}` } } as DecryptedMessage)),
      channels: () => channels,
      index: async (docs) => {
        for (const d of docs) w.docs!.set(d.id, d);
        return w.docs!.size;
      },
      now: () => clock.now,
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          // resting with nothing to do waits to be woken; anything else is the clock moving on
          if (ms >= 60_000) {
            signal.addEventListener("abort", () => resolve(), { once: true });
            return;
          }
          clock.now += ms;
          resolve();
        }),
      online: () => true,
      hidden: () => false,
      changed: () => {
        if (self?.throttled) w.throttleSeen = true;
      },
      save: (s) => {
        w.saved = s;
      },
    },
    { background: true, maxDocs: 1_000_000, ...opts },
    initial,
    0,
  );
  self = crawler;
  w.crawler = crawler;
  w.demand = (d) => crawler.setDemand(d);
  return w as World;
}

async function settle(w: World, until: () => boolean = () => !w.crawler.busy): Promise<void> {
  for (let i = 0; i < 20_000; i++) {
    if (until()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("the walk never settled");
}

describe("the crawl", () => {
  it("walks every conversation back to its first message, newest activity first", async () => {
    const w = world([
      ["a", 250, 0],
      ["b", 30, 5_000],
    ]);
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    expect(w.docs.size).toBe(280);
    // b has the newest message, so it goes first
    expect(w.calls[0]!.channel).toBe("b");
    expect(w.calls.filter((c) => c.channel === "a")).toHaveLength(3);
    expect(w.crawler.progress(w.channels)).toEqual({ total: 2, done: 2, unreadable: 0 });
    expect(w.saved?.channels["a"]).toMatchObject({ done: true, oldest: "1", newest: "250" });
  });

  it("paces its requests, and goes faster while a search waits", async () => {
    const w = world([["a", 500, 0]]);
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    const gaps = w.calls.slice(1).map((c, i) => c.at - w.calls[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(BACKGROUND_GAP_MS);

    const v = world([["a", 500, 0]], { background: false });
    v.demand(new Set(["a"]));
    v.crawler.start();
    await settle(v);
    v.crawler.stop();
    const fast = v.calls.slice(1).map((c, i) => c.at - v.calls[i]!.at);
    expect(Math.min(...fast)).toBeGreaterThanOrEqual(REQUEST_GAP_MS);
    expect(Math.max(...fast)).toBeLessThan(BACKGROUND_GAP_MS);
  });

  it("with the index in memory only, walks nothing until a search asks, then only what it asks for", async () => {
    const w = world(
      [
        ["a", 150, 0],
        ["b", 150, 1_000],
      ],
      { background: false },
    );
    w.crawler.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(w.calls).toHaveLength(0);
    w.demand(new Set(["a"]));
    await settle(w);
    expect(new Set(w.calls.map((c) => c.channel))).toEqual(new Set(["a"]));
    w.demand(null);
    w.crawler.stop();
  });

  it("gives a long conversation's turn away after a slice, then comes back to it", async () => {
    const long = (SLICE_PAGES + 5) * PAGE;
    const w = world([
      ["long", long, 100_000],
      ["short", 50, 0],
    ]);
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    const order = w.calls.map((c) => c.channel);
    // the long one had the newest message, so it starts, and gives way after its slice
    expect(order.slice(0, SLICE_PAGES)).toEqual(Array(SLICE_PAGES).fill("long"));
    expect(order[SLICE_PAGES]).toBe("short");
    expect(w.docs.size).toBe(long + 50);
  });

  it("picks up where the last session stopped, and only fetches what is new", async () => {
    const first = world([["a", 350, 0]]);
    first.crawler.start();
    await settle(first, () => first.saved?.channels["a"]?.oldest === "151");
    first.crawler.stop();
    const saved = first.saved!;
    expect(saved.channels["a"]).toMatchObject({ newest: "350", oldest: "151" });

    // a new session: forty more messages arrived meanwhile
    const again = world([["a", 390, 0]], {}, saved);
    again.crawler.start();
    await settle(again);
    again.crawler.stop();
    // one page to catch up, then on down from where it was
    expect(again.calls[0]!.q).toEqual({ after: "350", limit: PAGE });
    expect(again.calls.slice(1).map((c) => c.q.before)).toEqual(["151", "51"]);
    expect(again.saved?.channels["a"]).toMatchObject({ done: true, newest: "390", oldest: "1" });
  });

  it("keeps up with live messages once it has reached the present, and catches up after a reconnect", async () => {
    const w = world([["a", 10, 0]]);
    w.crawler.start();
    await settle(w);
    w.history.get("a")!.push(11);
    w.channels[0]!.last_message_id = "11";
    w.crawler.noteLive("a", "11");
    w.crawler.kick();
    await settle(w);
    // held live: nothing to fetch
    expect(w.calls).toHaveLength(1);
    expect(w.saved?.channels["a"]?.newest).toBe("11");

    // after a reconnect nothing can be trusted to have arrived
    w.crawler.resync();
    w.history.get("a")!.push(12);
    w.channels[0]!.last_message_id = "12";
    w.crawler.kick();
    await settle(w);
    w.crawler.stop();
    expect(w.calls.at(-1)!.q).toEqual({ after: "11", limit: PAGE });
    expect(w.docs.has("12")).toBe(true);
  });

  it("waits out a refusal and says it is waiting", async () => {
    const w = world([["a", 150, 0]]);
    w.fail.set("a", new ApiError(429, "rate_limited", "", 7));
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    expect(w.throttleSeen).toBe(true);
    expect(w.crawler.throttled).toBe(false);
    expect(w.calls[1]!.at - w.calls[0]!.at).toBeGreaterThanOrEqual(7_000);
    expect(w.docs.size).toBe(150);
  });

  it("marks a conversation it may not read, and one it has no key for, and looks again next session", async () => {
    const w = world([
      ["refused", 20, 0],
      ["nokey", 20, 1_000],
      ["partly", 150, 2_000],
    ]);
    w.fail.set("refused", new ApiError(403, "forbidden", ""));
    for (let i = 1001; i <= 1020; i++) w.locked.add(String(i));
    // the older of partly's two pages is from before this reader had a key
    for (let i = 2001; i <= 2050; i++) w.locked.add(String(i));
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    expect(w.crawler.progress(w.channels)).toEqual({ total: 3, done: 3, unreadable: 2 });
    expect(w.saved?.channels["partly"]).toMatchObject({ done: true, locked: true });
    expect(w.saved?.channels["partly"]?.unreadable).toBeUndefined();

    const next = world([
      ["refused", 20, 0],
      ["nokey", 20, 1_000],
      ["partly", 150, 2_000],
    ], {}, w.saved);
    next.crawler.start();
    await settle(next);
    next.crawler.stop();
    // one more look each, and the refused one is readable now
    expect(next.calls.map((c) => c.channel).sort()).toEqual(["nokey", "partly", "refused"]);
    // everything that was out of reach: all of two, and partly's older page
    expect(next.docs.size).toBe(20 + 20 + 50);
  });

  it("stops reaching back once the index is full", async () => {
    const w = world([["a", 1_000, 0]], { maxDocs: 300 });
    w.crawler.start();
    await settle(w);
    w.crawler.stop();
    expect(w.crawler.capped).toBe(true);
    expect(w.docs.size).toBe(300);
    expect(w.calls).toHaveLength(3);
  });
});
