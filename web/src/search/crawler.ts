/**
 * The walk that fills the search index.
 *
 * Messages are end-to-end encrypted, so the only way to search a
 * conversation's history is to fetch its ciphertext and decrypt it here. This
 * walks every conversation the account can read, newest page first, and hands
 * what it decrypts to the index; it remembers how far each conversation has
 * been walked, so a reload picks up where the last session stopped, and later
 * visits only fetch what arrived since.
 *
 * Three things keep it polite. Requests are paced (search/pacing.ts): a fifth
 * of the rate limit in the background, half while a search is waiting on it,
 * and slower while the app is out of sight; refusals are waited out. The walk
 * goes conversation by conversation, newest activity first, but a very long
 * one gives way after SLICE_PAGES pages so everything else gets its turn
 * before it goes on. And it stops the moment it is told to.
 *
 * With the index kept in memory only (the setting is off), nothing is walked
 * until a search needs it, and then only the conversations that search is in.
 */
import type { HistoryQuery } from "@/api/messages";
import { ApiError } from "@/api/client";
import type { Channel, Message } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";
import { toDoc, type SearchDoc } from "./doc";
import { BACKGROUND_GAP_MS, HIDDEN_GAP_MS, MAX_RETRIES, PAGE, REQUEST_GAP_MS, backoffFor, breathe, justAfter, pageIsAllLocked, retryable } from "./pacing";

/** How far one conversation has been walked. */
export interface ChannelCrawl {
  /** The newest message held with nothing missing between it and `oldest`. */
  newest?: string;
  /** How far back the walk has reached. */
  oldest?: string;
  /** Walked back to its first message, or to where this reader's keys begin. */
  done?: boolean;
  /** Stopped at messages this device holds no key for; worth one more look next session. */
  locked?: boolean;
  /** Nothing in it can be read here: no key at all, or the server refused its history. */
  unreadable?: boolean;
  /** Something in it was readable, so a locked page further down is where access begins. */
  readable?: boolean;
}

export interface CrawlState {
  v: 1;
  channels: Record<string, ChannelCrawl>;
}

/** Pages a conversation gets before the others have their turn. */
export const SLICE_PAGES = 20;

/** After a failure that was not a refusal, how long before that conversation is tried again. */
const RETRY_AFTER_MS = 60_000;

/** Messages decrypted between two turns of the event loop. */
const DECRYPT_BATCH = 25;

export interface CrawlerDeps {
  list: (channelId: string, q: HistoryQuery, signal: AbortSignal) => Promise<Message[]>;
  decrypt: (m: Message) => Promise<DecryptedMessage>;
  /** The conversations there are to walk. */
  channels: () => Channel[];
  /** Hands decrypted messages to the index; resolves with how many it now holds. */
  index: (docs: SearchDoc[]) => Promise<number>;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  online: () => boolean;
  hidden: () => boolean;
  /** Called whenever there is something new to say about progress. */
  changed: () => void;
  /** The walk moved on; worth saving. */
  save: (state: CrawlState) => void;
}

export interface CrawlerOptions {
  /** Walk everything (the index is kept), or only what a search asks for. */
  background: boolean;
  /** No further back once the index holds this many messages. */
  maxDocs: number;
}

type Job = { ch: Channel; kind: "catchup" | "backfill"; urgent: boolean };

/** The order conversations are walked in: the one with the newest message first. */
function byActivity(a: Channel, b: Channel): number {
  return compareIds(b.last_message_id ?? b.id, a.last_message_id ?? a.id);
}

function maxId(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return compareIds(a, b) >= 0 ? a : b;
}

export class Crawler {
  private readonly state: Map<string, ChannelCrawl>;
  /** Conversations whose newest message is known to be held, kept so by live messages. */
  private readonly live = new Set<string>();
  /** The newest message that arrived live in each conversation this session. */
  private readonly liveMax = new Map<string, string>();
  private readonly slices = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  private demand: Set<string> | "all" | null = null;
  private running = false;
  private ctrl: AbortController | null = null;
  private waker: AbortController | null = null;
  private last = 0;
  private docs: number;
  /** Refused and waiting it out right now. */
  throttled = false;

  constructor(
    private readonly deps: CrawlerDeps,
    private readonly opts: CrawlerOptions,
    initial: CrawlState | null,
    docs: number,
  ) {
    this.state = new Map(Object.entries(initial?.channels ?? {}));
    this.docs = docs;
    // A conversation that stopped at messages it had no key for, or whose
    // history the server refused, gets one more look each session: a key may
    // have arrived since, or a role that lets its history be read.
    for (const c of this.state.values()) {
      if (!c.locked && !c.unreadable) continue;
      c.done = false;
      delete c.unreadable;
    }
  }

  /** Reached the most the index may hold; older history is left unread. */
  get capped(): boolean {
    return this.docs >= this.opts.maxDocs;
  }

  snapshot(): CrawlState {
    const channels: Record<string, ChannelCrawl> = {};
    for (const [id, c] of this.state) channels[id] = { ...c };
    return { v: 1, channels };
  }

  setDocs(n: number): void {
    this.docs = n;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.ctrl = new AbortController();
    void this.loop(this.ctrl.signal);
  }

  stop(): void {
    this.running = false;
    this.ctrl?.abort();
    this.ctrl = null;
    this.waker?.abort();
  }

  /** Something changed that may mean there is work: wake the walk if it is resting. */
  kick(): void {
    this.waker?.abort();
  }

  /** What a search is waiting on: some conversations, everything, or nothing. */
  setDemand(d: Set<string> | "all" | null): void {
    this.demand = d;
    this.kick();
  }

  /**
   * A reconnect: live messages may have been missed while the socket was
   * down, so no conversation's newest message can be trusted to be held any
   * more, and each is caught up again.
   */
  resync(): void {
    this.live.clear();
    this.liveMax.clear();
    this.kick();
  }

  /** A message arrived live and was indexed. */
  noteLive(channelId: string, id: string): void {
    this.liveMax.set(channelId, maxId(this.liveMax.get(channelId), id)!);
    const c = this.state.get(channelId);
    if (c && this.live.has(channelId)) {
      c.newest = maxId(c.newest, id);
      this.deps.save(this.snapshot());
    }
  }

  forget(channelId: string): void {
    this.state.delete(channelId);
    this.live.delete(channelId);
    this.liveMax.delete(channelId);
    this.slices.delete(channelId);
    this.deps.save(this.snapshot());
  }

  /** Starts a conversation's walk over, for history on disk that could not be read. */
  restart(channelId: string): void {
    this.state.set(channelId, {});
    this.live.delete(channelId);
  }

  /** Whether a conversation has been walked all the way (or cannot be). */
  isDone(ch: Channel): boolean {
    const c = this.state.get(ch.id);
    if (c?.unreadable) return true;
    // never a message in it: nothing to walk
    if (!ch.last_message_id && !c?.oldest) return true;
    return !!c?.done && !this.needsCatchup(ch, c);
  }

  isUnreadable(channelId: string): boolean {
    return !!this.state.get(channelId)?.unreadable;
  }

  /** How many of these conversations are walked. */
  progress(channels: Channel[]): { total: number; done: number; unreadable: number } {
    let done = 0;
    let unreadable = 0;
    for (const ch of channels) {
      if (this.isDone(ch)) done += 1;
      if (this.isUnreadable(ch.id)) unreadable += 1;
    }
    return { total: channels.length, done, unreadable };
  }

  /** Whether the walk has anything it could do right now (for "still indexing"). */
  get busy(): boolean {
    return this.next() !== null;
  }

  private needsCatchup(ch: Channel, c: ChannelCrawl): boolean {
    return !c.unreadable && !!c.newest && !!ch.last_message_id && compareIds(ch.last_message_id, c.newest) > 0;
  }

  private wanted(ch: Channel): boolean {
    return this.demand === "all" || (this.demand !== null && this.demand.has(ch.id));
  }

  /** What to fetch next, if anything. */
  private next(): Job | null {
    const now = this.deps.now();
    const all = this.deps.channels().slice().sort(byActivity);
    const eligible = all.filter((ch) => {
      const at = this.retryAt.get(ch.id);
      return !(at && at > now) && !this.state.get(ch.id)?.unreadable;
    });
    const wanted = eligible.filter((ch) => this.wanted(ch));
    const pick = (list: Channel[], urgent: boolean, slices: boolean): Job | null => {
      for (const ch of list) {
        const c = this.state.get(ch.id) ?? {};
        if (this.needsCatchup(ch, c)) return { ch, kind: "catchup", urgent };
      }
      // full: what arrives is still taken in, but no further back
      if (this.capped) return null;
      let starved = false;
      for (const ch of list) {
        const c = this.state.get(ch.id) ?? {};
        if (c.done) continue;
        if (!ch.last_message_id && !c.oldest) continue;
        if (slices && (this.slices.get(ch.id) ?? 0) >= SLICE_PAGES) {
          starved = true;
          continue;
        }
        return { ch, kind: "backfill", urgent };
      }
      // everyone has had their turn: the next round starts
      if (starved) {
        this.slices.clear();
        return pick(list, urgent, slices);
      }
      return null;
    };
    const first = pick(wanted, true, false);
    if (first || !this.opts.background) return first;
    return pick(eligible, false, true);
  }

  private async rest(signal: AbortSignal, ms: number): Promise<void> {
    const waker = new AbortController();
    this.waker = waker;
    const both = new AbortController();
    const stop = () => both.abort();
    signal.addEventListener("abort", stop, { once: true });
    waker.signal.addEventListener("abort", stop, { once: true });
    await this.deps.sleep(ms, both.signal);
    signal.removeEventListener("abort", stop);
    if (this.waker === waker) this.waker = null;
  }

  private gap(urgent: boolean): number {
    if (urgent) return REQUEST_GAP_MS;
    return this.deps.hidden() ? HIDDEN_GAP_MS : BACKGROUND_GAP_MS;
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const job = this.next();
      this.deps.changed();
      if (!job) {
        // nothing to do; a message, a new conversation or a search wakes it,
        // and it looks again now and then for what failed a while ago
        await this.rest(signal, RETRY_AFTER_MS);
        continue;
      }
      if (!this.deps.online()) {
        await this.rest(signal, 5_000);
        continue;
      }
      const wait = this.last + this.gap(job.urgent) - this.deps.now();
      if (wait > 0) {
        // a search starting while this waits shortens the wait
        await this.rest(signal, wait);
        if (signal.aborted) return;
        if (this.last + this.gap(this.next()?.urgent ?? job.urgent) > this.deps.now()) continue;
      }
      try {
        await this.run(job, signal);
      } catch (err) {
        if (signal.aborted) return;
        console.warn("search index: could not walk a conversation", job.ch.id, err);
        this.retryAt.set(job.ch.id, this.deps.now() + RETRY_AFTER_MS);
      }
    }
  }

  /** One page, paced and retried; null when the conversation's history is refused for good. */
  private async fetch(ch: Channel, q: HistoryQuery, signal: AbortSignal): Promise<Message[] | null> {
    for (let attempt = 0; ; attempt++) {
      this.last = this.deps.now();
      try {
        const page = await this.deps.list(ch.id, q, signal);
        if (this.throttled) {
          this.throttled = false;
          this.deps.changed();
        }
        return page;
      } catch (err) {
        if (signal.aborted) throw err;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
        if (!retryable(err) || attempt >= MAX_RETRIES) throw err;
        // A 429 is the server telling us to slow down; waiting it out is the
        // whole point of pacing, and the search says it is waiting so the
        // pause is not read as a hang.
        this.throttled = true;
        this.deps.changed();
        await this.deps.sleep(backoffFor(err, attempt), signal);
        if (signal.aborted) throw err;
      }
    }
  }

  private async decrypt(page: Message[], signal: AbortSignal): Promise<DecryptedMessage[]> {
    const out: DecryptedMessage[] = [];
    for (let i = 0; i < page.length && !signal.aborted; i += DECRYPT_BATCH) {
      out.push(...(await Promise.all(page.slice(i, i + DECRYPT_BATCH).map(this.deps.decrypt))));
      await breathe();
    }
    return out;
  }

  private async take(msgs: DecryptedMessage[]): Promise<boolean> {
    const docs = msgs.map(toDoc).filter((d): d is SearchDoc => d !== null);
    if (docs.length) this.docs = await this.deps.index(docs);
    return docs.length > 0;
  }

  private async run(job: Job, signal: AbortSignal): Promise<void> {
    const { ch } = job;
    const c = this.state.get(ch.id) ?? {};
    this.state.set(ch.id, c);
    if (job.kind === "catchup") {
      const page = await this.fetch(ch, { after: c.newest!, limit: PAGE }, signal);
      if (signal.aborted) return;
      if (page === null) {
        c.unreadable = true;
        c.done = true;
      } else {
        const msgs = await this.decrypt(page, signal);
        if (signal.aborted) return;
        if (await this.take(msgs)) c.readable = true;
        const top = page[page.length - 1]?.id;
        c.newest = maxId(c.newest, top);
        if (page.length < PAGE) {
          // Caught up with the present. What arrived live while this was on
          // its way is held too, and everything after it arrives live.
          c.newest = maxId(c.newest, this.liveMax.get(ch.id));
          this.live.add(ch.id);
        }
      }
      this.deps.save(this.snapshot());
      return;
    }
    // back through history from wherever the walk had got to
    const cursor = c.oldest ?? justAfter(ch.last_message_id ?? "0");
    const page = await this.fetch(ch, { before: cursor, limit: PAGE }, signal);
    if (signal.aborted) return;
    if (page === null) {
      c.unreadable = true;
      c.done = true;
      this.deps.save(this.snapshot());
      return;
    }
    const msgs = await this.decrypt(page, signal);
    if (signal.aborted) return;
    if (await this.take(msgs)) c.readable = true;
    if (!c.newest && page.length > 0) {
      // the first page reaches the present, and live messages carry on from it
      c.newest = maxId(page[page.length - 1]!.id, this.liveMax.get(ch.id));
      this.live.add(ch.id);
    }
    const locked = pageIsAllLocked(msgs);
    const next = page[0]?.id;
    this.slices.set(ch.id, (this.slices.get(ch.id) ?? 0) + 1);
    // `before` is exclusive, so a page always starts below the cursor it was
    // asked for; a server that answered otherwise would walk this for ever
    const moved = next !== undefined && compareIds(next, cursor) < 0;
    // A page with no key for any of it keeps the cursor above it, so the
    // look next session starts with that page.
    if (moved && !locked) c.oldest = next;
    if (page.length < PAGE || locked || !moved) {
      c.done = true;
      if (locked) c.locked = true;
      else delete c.locked;
      // no key for the newest page and none before: this device cannot read it
      if (locked && !c.readable) c.unreadable = true;
    }
    this.deps.save(this.snapshot());
  }
}
