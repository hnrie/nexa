/**
 * The search index, as the app runs it.
 *
 * It opens once the account's session is ready (its keys, its settings, its
 * conversations), in a worker (search/worker.ts). It closes the moment the
 * keys go, on a lock or a sign-out, which ends the worker and everything it
 * held. A sign-out, or turning the setting off, also wipes it from this
 * device: the key that sealed it first (search/keys.ts), then the database.
 *
 * While open it is fed from three places: the walk through history
 * (search/crawler.ts), the messages that arrive, change and go live, and the
 * pages the chat loads anyway, which also show what was deleted or edited
 * while this device was not listening.
 */
import { create } from "zustand";
import { messages as messagesApi } from "@/api/messages";
import type { Channel } from "@/api/types";
import { dispatchHooks, type MessageChange } from "@/gateway/dispatch";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";
import { logoutHooks, useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { keysGoneHooks } from "@/stores/keys";
import { historyHooks } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { createBackend, type Backend } from "./backend";
import type { Mutation, OpenResult } from "./core";
import { Crawler, type ChannelCrawl, type CrawlState } from "./crawler";
import { toDoc, type SearchDoc } from "./doc";
import { EMPTY_RESULT, type EngineRequest, type EngineResult } from "./engine";
import { indexKeyFor, wipeSearchIndex } from "./keys";
import { sleep } from "./pacing";

/**
 * The most messages the index holds before it stops reaching further back.
 * Kept on disk it is read into the worker's memory whole, and a hundred and
 * fifty thousand messages is some tens of megabytes there; in memory only,
 * for one session, the old limit of fifty thousand stands.
 */
export const MAX_DISK_DOCS = 150_000;
export const MAX_MEMORY_DOCS = 50_000;

export type IndexMode = "closed" | "opening" | "memory" | "disk";

export interface IndexStatus {
  /** Closed (locked, signed out), opening, or open: on disk, or for this session only. */
  mode: IndexMode;
  /** Messages it holds. */
  docs: number;
  /** Conversations there are to search, how many are walked to their start, and how many this device cannot read. */
  total: number;
  done: number;
  unreadable: number;
  /** The walk still has something it could fetch. */
  walking: boolean;
  /** The server asked for a pause and it is being waited out. */
  throttled: boolean;
  /** Full: older history is left unread. */
  capped: boolean;
  /** Moves on whenever what it holds changes, so an open search can ask again. */
  version: number;
}

const CLOSED: IndexStatus = { mode: "closed", docs: 0, total: 0, done: 0, unreadable: 0, walking: false, throttled: false, capped: false, version: 0 };

export const useSearchIndex = create<IndexStatus>(() => CLOSED);

/** Conversations that hold messages: categories and voice rooms hold none. */
const SEARCHABLE = new Set(["text", "dm", "group_dm", "subchat"]);

export function searchableChannels(byId: Record<string, Channel> = useChannels.getState().byId): Channel[] {
  return Object.values(byId).filter((c) => SEARCHABLE.has(c.type));
}

let backend: Backend | null = null;
let crawler: Crawler | null = null;
let openFor: string | null = null;
/** Moves on with every open and close, so work begun for one never lands in the next. */
let gen = 0;

function bump(m: Mutation | null): void {
  if (!m) return;
  useSearchIndex.setState((s) => ({ docs: m.docs, version: m.changed ? s.version + 1 : s.version }));
  crawler?.setDocs(m.docs);
}

/** Sends an operation that changes the index, if it is open; failures are logged, not thrown. */
function mutate(op: Parameters<Backend["call"]>[0]): void {
  const be = backend;
  if (!be) return;
  const g = gen;
  be.call<Mutation>(op).then(
    (m) => {
      if (g === gen) bump(m);
    },
    (err: unknown) => {
      if (g === gen) console.warn("search index: an update did not go through", err);
    },
  );
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Works progress out again, at most a few times a second. */
function refresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const c = crawler;
    if (!c) return;
    const p = c.progress(searchableChannels());
    useSearchIndex.setState({ total: p.total, done: p.done, unreadable: p.unreadable, walking: c.busy, throttled: c.throttled, capped: c.capped });
  }, 200);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCrawl: CrawlState | null = null;

function saveCrawl(state: CrawlState): void {
  pendingCrawl = state;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = pendingCrawl;
    pendingCrawl = null;
    if (s && backend) void backend.call({ op: "crawl", state: s }).catch(() => undefined);
  }, 1_500);
}

function isCrawl(v: unknown): v is ChannelCrawl {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const optId = (x: unknown) => x === undefined || (typeof x === "string" && /^\d+$/.test(x));
  const optBool = (x: unknown) => x === undefined || typeof x === "boolean";
  return optId(c["newest"]) && optId(c["oldest"]) && optBool(c["done"]) && optBool(c["locked"]) && optBool(c["unreadable"]) && optBool(c["readable"]);
}

/** A saved walk as the crawler takes it, with anything that does not look right left out. */
export function parseCrawl(v: unknown): CrawlState | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as { v?: unknown; channels?: unknown };
  if (s.v !== 1 || typeof s.channels !== "object" || s.channels === null) return null;
  const channels: Record<string, ChannelCrawl> = {};
  for (const [id, c] of Object.entries(s.channels as Record<string, unknown>)) if (/^\d+$/.test(id) && isCrawl(c)) channels[id] = c;
  return { v: 1, channels };
}

const demands = new Map<number, string[] | null>();
let demandSeq = 0;

function currentDemand(): Set<string> | "all" | null {
  if (demands.size === 0) return null;
  const out = new Set<string>();
  for (const d of demands.values()) {
    if (d === null) return "all";
    for (const id of d) out.add(id);
  }
  return out;
}

/**
 * A search that is waiting on these conversations (null: on everything). The
 * walk goes to them first, at the faster pace, and with the index kept in
 * memory only they are the only ones it walks at all. Call what comes back
 * once the search is closed.
 */
export function demandIndex(channels: string[] | null): () => void {
  const id = ++demandSeq;
  demands.set(id, channels);
  crawler?.setDemand(currentDemand());
  return () => {
    demands.delete(id);
    crawler?.setDemand(currentDemand());
  };
}

/** How far the walk has got through some conversations (null: all of them). */
export function scopeProgress(channelIds: string[] | null): { total: number; done: number; unreadable: number } {
  const all = searchableChannels();
  const list = channelIds ? all.filter((c) => channelIds.includes(c.id)) : all;
  return crawler ? crawler.progress(list) : { total: list.length, done: 0, unreadable: 0 };
}

/** Asks the index. Answers nothing while it is closed; waits while it opens. */
export async function querySearch(req: EngineRequest): Promise<EngineResult> {
  const be = backend;
  if (!be) return EMPTY_RESULT;
  try {
    return await be.call<EngineResult>({ op: "query", req });
  } catch {
    return EMPTY_RESULT;
  }
}

/*
 * One tab writes the index; the others read it. Two tabs of the same account
 * writing the same blocks would each overwrite what the other had just added,
 * and messages would quietly drop out of search. The writer holds a lock
 * (Web Locks, shared by every tab of this browser) for as long as its index is
 * open. Another tab opens what is on disk read-only, walks only what its own
 * searches need, keeps what it learns in memory, and takes over as the writer
 * when the lock comes free.
 */
let lockRelease: (() => void) | null = null;
let lockWait: AbortController | null = null;

type LockRequest = (name: string, opts: { ifAvailable?: boolean; signal?: AbortSignal }, cb: (lock: unknown) => unknown) => Promise<unknown>;

function lockApi(): { request: LockRequest } | null {
  const locks = typeof navigator !== "undefined" ? (navigator as { locks?: { request: LockRequest } }).locks : undefined;
  return locks ?? null;
}

const lockName = (userId: string) => `nexa-search-${userId}`;

/**
 * Takes the writer's lock if no other tab holds it: its release, null when
 * another tab writes, or "none" where the browser has no locks to share (the
 * tab then writes, as it did before locks).
 */
function takeLock(userId: string): Promise<(() => void) | null | "none"> {
  const api = lockApi();
  if (!api) return Promise.resolve("none");
  return new Promise((resolve) => {
    api
      .request(lockName(userId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(() => resolve("none"));
  });
}

/** Waits for the writer's lock, and opens the index as its writer once it comes. */
function waitForLock(opts: OpenOptions): void {
  const api = lockApi();
  if (!api) return;
  const ctrl = new AbortController();
  lockWait = ctrl;
  api
    .request(lockName(opts.userId), { signal: ctrl.signal }, () => {
      if (ctrl.signal.aborted) return undefined;
      return new Promise<void>((release) => void openSearchIndex({ ...opts, heldLock: release }));
    })
    .catch(() => undefined);
}

/** Stops the walk and ends the worker. With `flush`, what was changed is written first. */
function shutdown(flush: boolean): void {
  gen += 1;
  lockWait?.abort();
  lockWait = null;
  const release = lockRelease;
  lockRelease = null;
  crawler?.stop();
  crawler = null;
  const be = backend;
  backend = null;
  openFor = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const last = pendingCrawl;
  pendingCrawl = null;
  useSearchIndex.setState(CLOSED);
  if (!be) {
    release?.();
    return;
  }
  if (!flush) {
    be.terminate();
    release?.();
    return;
  }
  // the lock goes once the last writes are in, so the next writer reads them
  const done = (): void => {
    be.terminate();
    release?.();
  };
  // a write that does not come back within a couple of seconds is left
  const writes = (last ? be.call({ op: "crawl", state: last }) : Promise.resolve()).then(() => be.call({ op: "flush" }));
  void Promise.race([writes, sleep(2_000)]).then(done, done);
}

/** Opens the index for the signed-in account, as its settings say to keep it. */
async function open(): Promise<void> {
  const auth = useAuth.getState();
  const me = auth.me;
  const identity = auth.identity;
  if (!me || !identity || auth.status !== "ready" || !useSettings.getState().loaded) return;
  await openSearchIndex({ userId: me.id, identityPrivateKey: identity.privateKey, keep: useSettings.getState().settings.searchIndex !== false });
}

interface OpenOptions {
  userId: string;
  identityPrivateKey: Uint8Array | null;
  keep: boolean;
  /** The writer's lock, already taken (by waiting for it). */
  heldLock?: () => void;
}

/**
 * Opens the index for an account: kept on this device (sealed under a key
 * derived from `identityPrivateKey`), or with `keep` false in memory only.
 */
export async function openSearchIndex(opts: OpenOptions): Promise<void> {
  shutdown(true);
  const g = gen;
  const userId = opts.userId;
  openFor = userId;
  useSearchIndex.setState({ ...CLOSED, mode: "opening" });
  const keeps = opts.keep && !!opts.identityPrivateKey;
  // this tab writes the index, or reads the one another tab writes
  let release: (() => void) | null = opts.heldLock ?? null;
  let writer = !!release;
  if (!writer && keeps) {
    const got = await takeLock(userId);
    if (got === "none") writer = true;
    else if (got) {
      release = got;
      writer = true;
    }
  }
  if (g !== gen) {
    release?.();
    return;
  }
  lockRelease = release;
  const be = createBackend();
  backend = be;
  let key: Awaited<ReturnType<typeof indexKeyFor>> = null;
  if (keeps) {
    try {
      key = await indexKeyFor(userId, opts.identityPrivateKey!, { create: writer });
    } catch (err) {
      console.warn("search index: no key for it on this device", err);
    }
  } else if (!opts.keep) {
    // Turned off, perhaps on another device: nothing is kept here either.
    await wipeSearchIndex(userId);
  }
  if (g !== gen) return;
  let res: OpenResult;
  try {
    res = await be.call<OpenResult>({ op: "open", userId, key: key?.key ?? null, reset: key?.fresh ?? false, readOnly: !writer });
  } catch (err) {
    console.warn("search index: could not open", err);
    if (g === gen) shutdown(false);
    return;
  }
  if (g !== gen) return;
  // A reader's index is kept on this device all the same (by the writer), and
  // it takes over the writing when the writer goes.
  const reader = keeps && !writer;
  if (reader) waitForLock(opts);
  const mode = res.persisted || reader ? "disk" : "memory";
  const c = new Crawler(
    {
      list: (channelId, q, signal) => messagesApi.list(channelId, q, { signal }),
      decrypt: decryptForStore,
      channels: () => searchableChannels(),
      index: async (docs: SearchDoc[]) => {
        const m = await be.call<Mutation>({ op: "upsert", docs });
        if (g === gen) bump(m);
        return m.docs;
      },
      now: () => Date.now(),
      sleep,
      online: () => useUI.getState().connection === "open" && (typeof navigator === "undefined" || navigator.onLine !== false),
      hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      changed: refresh,
      save: saveCrawl,
    },
    // only the writer walks everything; a reader walks what its searches need
    { background: res.persisted, maxDocs: mode === "disk" ? MAX_DISK_DOCS : MAX_MEMORY_DOCS },
    parseCrawl(res.crawl),
    res.docs,
  );
  for (const ch of res.lost) c.restart(ch);
  // Conversations this account can no longer see (a server left, a group
  // left) go from the index. Only against a list that has arrived: an empty
  // one says nothing.
  const known = new Set(searchableChannels().map((ch) => ch.id));
  if (known.size > 0) {
    for (const ch of Object.keys(res.counts)) if (!known.has(ch)) void be.call({ op: "removeChannel", channel: ch }).catch(() => undefined);
    for (const ch of Object.keys(c.snapshot().channels)) if (!known.has(ch)) c.forget(ch);
  }
  crawler = c;
  useSearchIndex.setState({ mode, docs: res.docs, version: useSearchIndex.getState().version + 1 });
  c.setDemand(currentDemand());
  c.start();
  refresh();
}

/** Closes the index, ending its worker; what it holds on disk stays. */
export function closeSearchIndex(): void {
  shutdown(false);
}

/** Every ready: the first opens the index, one after a reconnect catches it up. */
function onReady(): void {
  const me = useAuth.getState().me;
  if (crawler && backend && me && openFor === me.id) {
    crawler.resync();
    return;
  }
  void open();
}

function onLive(_m: unknown, _mine: boolean, decrypted: DecryptedMessage): void {
  if (!backend) return;
  const doc = toDoc(decrypted);
  if (!doc) return;
  mutate({ op: "upsert", docs: [doc] });
  crawler?.noteLive(doc.c, doc.id);
}

function onChange(c: MessageChange): void {
  if (!backend) return;
  switch (c.kind) {
    case "update": {
      const doc = toDoc(c.msg);
      mutate(doc ? { op: "upsert", docs: [doc] } : { op: "remove", ids: [c.msg.id] });
      return;
    }
    case "delete":
      mutate({ op: "remove", ids: c.ids });
      return;
    case "pin":
      mutate({ op: "pin", id: c.id, pinned: c.pinned });
      return;
    case "channelsGone":
      for (const id of c.channelIds) {
        mutate({ op: "removeChannel", channel: id });
        crawler?.forget(id);
      }
      return;
  }
}

/**
 * A page of history the chat fetched. Its messages go in as they are, and
 * anything the index holds between its first and last message that the page
 * does not have was deleted while nobody here was listening.
 */
function onHistory(channelId: string, page: DecryptedMessage[]): void {
  if (!backend || !SEARCHABLE.has(useChannels.getState().byId[channelId]?.type ?? "")) return;
  const docs = page.map(toDoc).filter((d): d is SearchDoc => d !== null);
  if (docs.length) mutate({ op: "upsert", docs });
  if (page.length < 2) return;
  const ids = page.map((m) => m.id).sort(compareIds);
  mutate({ op: "reconcile", channel: channelId, low: ids[0]!, high: ids[ids.length - 1]!, present: ids });
}

/**
 * Signing out: the worker goes at once, without writing anything more. The
 * sign-out itself wipes what is on disk (stores/auth.ts), whether or not the
 * index was ever opened in this tab.
 */
async function onLogout(): Promise<void> {
  shutdown(false);
}

/** Wipes the index here and starts it again, walking everything afresh. */
export async function rebuildSearchIndex(): Promise<void> {
  const id = useAuth.getState().me?.id;
  shutdown(false);
  if (id) await wipeSearchIndex(id);
  await open();
}

let installed = false;

/** Wires the index into the app; called once the app shell is up. */
export function installSearchIndex(): void {
  if (installed) return;
  installed = true;
  dispatchHooks.onReady.push(onReady);
  dispatchHooks.onMessage.push(onLive);
  dispatchHooks.onMessageChange.push(onChange);
  historyHooks.push(onHistory);
  // first, before the session's own teardown forgets the keys and would have it write out what it holds
  logoutHooks.unshift(onLogout);
  // the keys going (a lock, a sign-out) takes the index with them
  keysGoneHooks.push(() => shutdown(true));
  // the setting, changed here or on another device
  useSettings.subscribe((s, prev) => {
    if (!s.loaded || !prev.loaded || s.settings.searchIndex === prev.settings.searchIndex) return;
    if (s.settings.searchIndex) void open();
    else void rebuildSearchIndex();
  });
  // a new conversation, or a message that moves one along, may be work
  useChannels.subscribe(() => crawler?.kick());
  useUI.subscribe((s, prev) => {
    if (s.connection === "open" && prev.connection !== "open") crawler?.kick();
  });
  // what changed in the last second is written before the page may go
  const flushNow = () => void backend?.call({ op: "flush" }).catch(() => undefined);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushNow();
      crawler?.kick();
    });
    window.addEventListener("pagehide", flushNow);
  }
  // a session already under way when this was installed
  if (useAuth.getState().status === "ready" && useSettings.getState().loaded && Object.keys(useChannels.getState().byId).length > 0) void open();
}
