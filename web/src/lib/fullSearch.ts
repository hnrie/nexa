/**
 * Searching everything, not only what is on screen.
 *
 * Messages are end-to-end encrypted, so the server holds nothing it could
 * index; searching text means fetching ciphertext and decrypting it here. This
 * walks every conversation the account can read, newest first, matching as it
 * goes, and keeps what it decrypted for the rest of the session so the second
 * search costs almost nothing.
 *
 * Three things keep that from being hostile to the instance and to the tab. It
 * paces its requests so the rate limiter never sees a burst, and waits out the
 * refusals it does get; it hands the event loop back between batches, because a
 * page of decryptions is real work and a frozen tab is worse than a slow
 * search; and it stops wherever it had got to the moment its signal aborts.
 */

import { ApiError } from "@/api/client";
import { messages as messagesApi } from "@/api/messages";
import type { Message } from "@/api/types";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";
import { matches, type SearchCtx, type SearchQuery } from "@/lib/search";

/** The most messages one request may ask for; the server refuses more than 100. */
export const PAGE = 100;

/**
 * The shortest gap between two history requests.
 *
 * The history endpoint sits behind the generic per-user limiter: 600 requests
 * a minute, burst 300. A page every 200 ms is 300 a minute — half the budget —
 * so a scan running in the background never starves the rest of the app and
 * never trips the limiter on its own. At a hundred messages a page that is
 * still five hundred messages a second, which is faster than the decryption
 * behind it anyway.
 */
export const REQUEST_GAP_MS = 200;

/** Tries a page gets before its conversation is given up on. */
const MAX_RETRIES = 4;

/** The first wait after a refusal with no Retry-After; it doubles from there. */
const BACKOFF_MS = 1_000;

/** However long a server asks us to wait, we stop waiting at this. */
const MAX_BACKOFF_MS = 30_000;

/**
 * What the session index holds before the walk stops reaching further back.
 *
 * A busy instance has far more history than a tab should keep in memory, and
 * the index is the price of the second search being instant. Fifty thousand
 * messages is roughly a year of a lively server; the byte cap catches the other
 * shape of the same problem, fewer but very long messages. Whichever comes
 * first stops the walk, and the panel says so rather than quietly implying it
 * read everything.
 */
export const MAX_INDEXED_MESSAGES = 50_000;
export const MAX_INDEXED_BYTES = 32 * 1024 * 1024;

/** Messages decrypted between two turns of the event loop. */
const DECRYPT_BATCH = 25;

/** Cached messages matched between two turns of the event loop. */
const MATCH_BATCH = 2_000;

/** Pages of catch-up a conversation gets before the walk takes over. */
const CATCHUP_PAGES = 20;

/** A conversation to walk, and the newest message it is known to hold. */
export interface ScanChannel {
  id: string;
  /** From the channel list; a conversation that never had a message is not fetched at all. */
  lastMessageId: string | null;
}

export interface ScanProgress {
  /** Messages examined this run, from the index and from the network alike. */
  messages: number;
  /** Messages the session index holds, which is what the cap is on. */
  indexed: number;
  /** Conversations walked to their start, or given up on. */
  channelsDone: number;
  channelsTotal: number;
  /** Conversations this device holds no key for, or whose history the server refused. */
  unreadable: number;
  /** The index filled up, so older history was left unread. */
  capped: boolean;
  /** The server asked us to slow down and we are waiting it out. */
  throttled: boolean;
  /** Still working. */
  running: boolean;
}

/** Everything the scan reaches the outside world through, so tests can replace it. */
export interface ScanDeps {
  list: (channelId: string, q: { before?: string; after?: string; limit?: number }, signal: AbortSignal) => Promise<Message[]>;
  decrypt: (m: Message) => Promise<DecryptedMessage>;
  /**
   * What the chat view has already decrypted for a conversation, so the page on
   * screen is never fetched a second time. `reachedStart` says the list runs
   * back to the conversation's first message.
   */
  seed?: (channelId: string) => { msgs: DecryptedMessage[]; reachedStart: boolean } | null;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

export interface ScanOptions {
  query: SearchQuery;
  ctx: SearchCtx;
  channels: ScanChannel[];
  /** Matches as they are found, roughly newest first across the whole account. */
  onHit: (msgs: DecryptedMessage[]) => void;
  onProgress: (p: ScanProgress) => void;
  signal: AbortSignal;
  deps?: Partial<ScanDeps>;
}

/** One conversation's decrypted history, and how far back it has been walked. */
interface ChannelIndex {
  byId: Map<string, DecryptedMessage>;
  /** Oldest id held; the next older page is asked for `before` it. */
  oldest: string | null;
  /** Newest id held; a later search asks for whatever arrived `after` it. */
  newest: string | null;
  /**
   * There is nothing further back worth asking for: either the conversation's
   * first message is in hand, or the walk has reached the point before which
   * this reader holds no key.
   */
  done: boolean;
  /** No key for this conversation at all, or the server would not give us its history. */
  unreadable: boolean;
}

const index = new Map<string, ChannelIndex>();
let indexedMessages = 0;
let indexedBytes = 0;

/**
 * Forgets every decrypted message.
 *
 * Called when the keys go: plaintext that outlived the keyring would let the
 * next person on this tab read a conversation they hold no grant for.
 */
export function clearSearchIndex(): void {
  index.clear();
  indexedMessages = 0;
  indexedBytes = 0;
}

export function indexStats(): { messages: number; channels: number; bytes: number; full: boolean } {
  return { messages: indexedMessages, channels: index.size, bytes: indexedBytes, full: isFull() };
}

/** The walk reaches no further back than this. */
function isFull(): boolean {
  return indexedMessages >= MAX_INDEXED_MESSAGES || indexedBytes >= MAX_INDEXED_BYTES;
}

/**
 * Past this, not even the messages that have just arrived are taken in.
 *
 * The cap is on how far back the walk reaches, not on the present: a search
 * that stopped finding today's messages because a tab had been open a while
 * would be a worse bug than one that used a little more memory than it said.
 * The headroom is what a session's own conversation can add on top, and a tab
 * left open long enough to fill it has bigger problems.
 */
function isOverflowing(): boolean {
  return indexedMessages >= MAX_INDEXED_MESSAGES * 2 || indexedBytes >= MAX_INDEXED_BYTES * 2;
}

/**
 * What the index keeps of a message.
 *
 * Not the ciphertext: it is the largest field on the wire, it is a base64 copy
 * of the plaintext we have just decrypted, and nothing downstream of here reads
 * it. Reactions and the server's attachment records go the same way — search
 * reads the payload's own attachment list, and a result row shows a name, a
 * time and some text.
 */
function trim(m: DecryptedMessage): DecryptedMessage {
  return { ...m, ciphertext: null, reactions: [], attachments: [] };
}

/** Roughly what one trimmed message costs, without walking the whole object. */
function weigh(m: DecryptedMessage): number {
  const text = (m.payload?.t?.length ?? 0) * 2;
  const att = (m.payload?.att?.length ?? 0) * 200;
  const embeds = (m.payload?.embeds?.length ?? 0) * 400;
  // Plus a flat allowance for the ids, timestamps and object headers every
  // message carries whether or not it says anything.
  return text + att + embeds + 300;
}

function entry(channelId: string): ChannelIndex {
  let c = index.get(channelId);
  if (!c) {
    c = { byId: new Map(), oldest: null, newest: null, done: false, unreadable: false };
    index.set(channelId, c);
  }
  return c;
}

/** Adds decrypted messages to a conversation's index, keeping its two cursors honest. */
function remember(c: ChannelIndex, msgs: DecryptedMessage[]): DecryptedMessage[] {
  const added: DecryptedMessage[] = [];
  for (const m of msgs) {
    if (c.byId.has(m.id)) continue;
    const kept = trim(m);
    c.byId.set(m.id, kept);
    added.push(kept);
    indexedMessages += 1;
    indexedBytes += weigh(kept);
    if (c.oldest === null || compareIds(m.id, c.oldest) < 0) c.oldest = m.id;
    if (c.newest === null || compareIds(m.id, c.newest) > 0) c.newest = m.id;
  }
  return added;
}

/**
 * Hands the event loop back.
 *
 * `scheduler.yield()` resumes ahead of the tasks queued behind it, so a scan
 * does not lose its place to every pending timer; where it is missing a zero
 * timeout is the same idea with a worse guarantee.
 */
function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === "function") return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** A refusal worth waiting out, as opposed to one that will never succeed. */
function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  // 0 is the client's own stand-in for a timeout or a dead network.
  return err.status === 429 || err.status === 0 || err.status >= 500;
}

/** How long to wait before asking for a page again; the server's own answer wins. */
export function backoffFor(err: unknown, attempt: number): number {
  const asked = err instanceof ApiError && err.retryAfter !== undefined ? err.retryAfter * 1000 : 0;
  const grown = BACKOFF_MS * 2 ** attempt;
  return Math.min(Math.max(asked, grown), MAX_BACKOFF_MS);
}

/**
 * Whether a page says the walk has reached the edge of what its reader may
 * read. Someone added to a server last month can decrypt last month's history
 * and nothing before the grant, and paging through the years before it would
 * cost thousands of requests to decrypt nothing.
 */
export function pageIsAllLocked(page: DecryptedMessage[]): boolean {
  return page.length > 0 && page.every((m) => m.decryptError === "no_key");
}

/**
 * The conversation whose next page holds the newest messages.
 *
 * Walking one conversation to its start before starting the next would put
 * every result from the last conversation at the end of a long wait. Taking the
 * highest cursor each time interleaves them, so results stream out in roughly
 * the order a reader expects: newest first, wherever they are from.
 */
export function pickNext(cursors: Map<string, string>): string | null {
  let best: string | null = null;
  let bestCursor = "";
  for (const [id, cursor] of cursors) {
    if (best === null || compareIds(cursor, bestCursor) > 0) {
      best = id;
      bestCursor = cursor;
    }
  }
  return best;
}

/** One past an id, so a page asked for `before` it still includes it. */
function justAfter(id: string): string {
  try {
    return (BigInt(id) + 1n).toString();
  } catch {
    return id;
  }
}

/** Pacing state for one scan: when its last request went out. */
interface Pacer {
  last: number;
}

/**
 * Walks every conversation and reports what matched.
 *
 * Resolves with the final progress whether it finished or was cancelled;
 * `running` says which. Never throws for a conversation it could not read.
 */
export async function scanEverything(opts: ScanOptions): Promise<ScanProgress> {
  const { query, ctx, channels, onHit, onProgress, signal } = opts;
  const deps: ScanDeps = {
    list: (channelId, q, sig) => messagesApi.list(channelId, q, { signal: sig }),
    decrypt: decryptForStore,
    sleep: defaultSleep,
    now: () => Date.now(),
    ...opts.deps,
  };
  const pacer: Pacer = { last: 0 };

  const progress: ScanProgress = {
    messages: 0,
    indexed: indexedMessages,
    channelsDone: 0,
    channelsTotal: channels.length,
    unreadable: 0,
    capped: false,
    throttled: false,
    running: true,
  };
  const report = (): void => onProgress({ ...progress, indexed: indexedMessages });

  const seen = new Set<string>();
  const emit = (found: DecryptedMessage[]): void => {
    const fresh = found.filter((m) => !seen.has(m.id));
    for (const m of fresh) seen.add(m.id);
    if (fresh.length) onHit(fresh);
  };

  // Everything this session has already decrypted is matched before a single
  // request goes out, so a repeated search — or a narrower one over the same
  // history — answers at once and only the unread tail costs anything.
  for (const ch of channels) {
    if (signal.aborted) break;
    const c = entry(ch.id);
    const seeded = deps.seed?.(ch.id);
    if (seeded) {
      remember(c, seeded.msgs);
      if (seeded.reachedStart && c.byId.size === seeded.msgs.length) c.done = true;
    }
    if (c.byId.size === 0) continue;
    let batch: DecryptedMessage[] = [];
    for (const m of c.byId.values()) {
      progress.messages += 1;
      if (matches(m, query, ctx)) batch.push(m);
      if (progress.messages % MATCH_BATCH === 0) {
        emit(batch);
        batch = [];
        report();
        await breathe();
      }
    }
    emit(batch);
  }
  report();

  // Where each conversation's walk picks up, and which need no walk at all.
  const cursors = new Map<string, string>();
  for (const ch of channels) {
    const c = entry(ch.id);
    if (c.unreadable) {
      progress.unreadable += 1;
      progress.channelsDone += 1;
      continue;
    }
    if (c.done) {
      progress.channelsDone += 1;
      continue;
    }
    // Nothing was ever sent here, so there is nothing to fetch.
    if (!ch.lastMessageId && c.byId.size === 0) {
      c.done = true;
      progress.channelsDone += 1;
      continue;
    }
    cursors.set(ch.id, c.oldest ?? justAfter(ch.lastMessageId ?? "0"));
  }
  report();

  // Whatever arrived since the last scan. One page is nearly always enough, and
  // this is what makes a second search cheap rather than a second full walk.
  for (const ch of channels) {
    if (signal.aborted) break;
    const c = index.get(ch.id);
    if (!c || c.unreadable || !c.newest) continue;
    if (!ch.lastMessageId || compareIds(ch.lastMessageId, c.newest) <= 0) continue;
    let after = c.newest;
    for (let i = 0; i < CATCHUP_PAGES && !signal.aborted && !isOverflowing(); i++) {
      const page = await fetchPage(ch.id, { after, limit: PAGE }, deps, pacer, signal, progress, report);
      if (signal.aborted) break;
      if (page === null) {
        c.unreadable = true;
        if (cursors.delete(ch.id)) progress.channelsDone += 1;
        progress.unreadable += 1;
        report();
        break;
      }
      if (page.length === 0) break;
      const decrypted = await decryptPage(page, deps, signal);
      progress.messages += decrypted.length;
      emit(remember(c, decrypted).filter((m) => matches(m, query, ctx)));
      report();
      if (page.length < PAGE) break;
      after = page[page.length - 1]!.id;
    }
  }

  // The walk back through history, newest page anywhere first.
  while (!signal.aborted) {
    const channelId = pickNext(cursors);
    // Nothing left to fetch is not the same as stopping early, and the panel
    // should only claim history was left unread when some of it was.
    if (channelId === null) break;
    if (isFull()) {
      progress.capped = true;
      break;
    }
    const cursor = cursors.get(channelId)!;
    const c = entry(channelId);

    const page = await fetchPage(channelId, { before: cursor, limit: PAGE }, deps, pacer, signal, progress, report);
    if (signal.aborted) break;
    if (page === null) {
      c.unreadable = true;
      cursors.delete(channelId);
      progress.unreadable += 1;
      progress.channelsDone += 1;
      report();
      continue;
    }
    const decrypted = await decryptPage(page, deps, signal);
    if (signal.aborted) break;
    progress.messages += decrypted.length;
    const hadPlaintext = [...c.byId.values()].some((m) => m.payload !== undefined);
    emit(remember(c, decrypted).filter((m) => matches(m, query, ctx)));

    const locked = pageIsAllLocked(decrypted);
    // `after:` puts a floor under the walk: once a whole page predates it,
    // everything older does too, and there is nothing down there to find.
    const tooOld = query.after !== null && decrypted.length > 0 && decrypted.every((m) => m.created_at < query.after!);
    // `before` is exclusive, so a page always starts below the cursor it was
    // asked for. A server that answered otherwise would walk this loop forever.
    const next = page[0]?.id;
    if (page.length < PAGE || locked || tooOld || next === undefined || compareIds(next, cursor) >= 0) {
      // A conversation whose newest page is already unreadable is one this
      // device holds no key for; one that turned unreadable part-way down has
      // simply been walked back to the day its reader was let in.
      if (locked && !hadPlaintext) {
        c.unreadable = true;
        progress.unreadable += 1;
      }
      c.done = true;
      cursors.delete(channelId);
      progress.channelsDone += 1;
    } else {
      cursors.set(channelId, next);
    }
    report();
  }

  progress.running = false;
  progress.throttled = false;
  progress.indexed = indexedMessages;
  report();
  return { ...progress };
}

/**
 * One page, paced and retried.
 *
 * `null` means the conversation cannot be read: the server refused it outright,
 * or it kept refusing long enough that the rest of the scan matters more.
 */
async function fetchPage(
  channelId: string,
  q: { before?: string; after?: string; limit?: number },
  deps: ScanDeps,
  pacer: Pacer,
  signal: AbortSignal,
  progress: ScanProgress,
  report: () => void,
): Promise<Message[] | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) return null;
    const wait = REQUEST_GAP_MS - (deps.now() - pacer.last);
    if (wait > 0) await deps.sleep(wait, signal);
    if (signal.aborted) return null;
    pacer.last = deps.now();
    try {
      const page = await deps.list(channelId, q, signal);
      if (progress.throttled) {
        progress.throttled = false;
        report();
      }
      return page;
    } catch (err) {
      if (signal.aborted) return null;
      if (!retryable(err) || attempt === MAX_RETRIES) return null;
      // A 429 is the instance telling us to slow down. Waiting it out is the
      // whole point of pacing, and a search that takes a while has nowhere to
      // be; the panel says it is waiting so the pause is not read as a hang.
      progress.throttled = true;
      report();
      await deps.sleep(backoffFor(err, attempt), signal);
    }
  }
  return null;
}

/** Decrypts a page in batches, letting the tab draw a frame between them. */
async function decryptPage(page: Message[], deps: ScanDeps, signal: AbortSignal): Promise<DecryptedMessage[]> {
  const out: DecryptedMessage[] = [];
  for (let i = 0; i < page.length; i += DECRYPT_BATCH) {
    if (signal.aborted) return out;
    const part = await Promise.all(page.slice(i, i + DECRYPT_BATCH).map(deps.decrypt));
    out.push(...part);
    await breathe();
  }
  return out;
}
