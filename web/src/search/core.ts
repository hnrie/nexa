/**
 * The search index's side of the conversation with the app: one operation at
 * a time against the engine and, when the index is kept on this device, the
 * block store. The search worker runs this; where there is no worker (tests,
 * a browser that refuses one) the app runs it in the page instead.
 *
 * Operations run strictly in order. A search waits behind the opening of the
 * index, and a message added while it opens lands after what was on disk, so
 * an older copy read from disk never overwrites a newer one from the network.
 */
import type { SearchDoc } from "./doc";
import { EMPTY_RESULT, SearchEngine, type EngineRequest, type EngineResult } from "./engine";
import { BlockStore, deleteIndex } from "./persist";

export type Op =
  | { op: "open"; userId: string; key: CryptoKey | null; reset: boolean }
  | { op: "upsert"; docs: SearchDoc[] }
  | { op: "remove"; ids: string[] }
  | { op: "pin"; id: string; pinned: boolean }
  | { op: "reconcile"; channel: string; low: string; high: string; present: string[] }
  | { op: "removeChannel"; channel: string }
  | { op: "crawl"; state: unknown }
  | { op: "query"; req: EngineRequest }
  | { op: "counts" }
  | { op: "flush" }
  | { op: "wipe" }
  | { op: "close" };

export interface OpenResult {
  /** The index is kept on disk (false: in memory for this session only). */
  persisted: boolean;
  docs: number;
  /** How far each conversation had been walked, as the app last saved it. */
  crawl: unknown;
  /** Conversations with history on disk that could not be read and has to be fetched again. */
  lost: string[];
  counts: Record<string, number>;
}

export interface Mutation {
  /** Messages the index holds now. */
  docs: number;
  /** Whether anything changed. */
  changed: boolean;
}

/** How long changes wait before they are written, so a burst is one write. */
const FLUSH_MS = 1_000;

export class SearchCore {
  private readonly engine = new SearchEngine();
  private store: BlockStore | null = null;
  private userId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  handle(msg: Op): Promise<unknown> {
    const run = this.queue.then(() => this.run(msg));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private schedule(): void {
    if (!this.store || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow().catch((err: unknown) => console.warn("search index: could not save", err));
    }, FLUSH_MS);
  }

  private async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.store?.flush((id) => this.engine.get(id));
  }

  private mutation(changed: boolean): Mutation {
    if (changed) this.schedule();
    return { docs: this.engine.size, changed };
  }

  private async run(msg: Op): Promise<unknown> {
    switch (msg.op) {
      case "open": {
        this.engine.clear();
        this.store?.close();
        this.store = null;
        this.userId = msg.userId;
        if (!msg.key) return { persisted: false, docs: 0, crawl: null, lost: [], counts: {} } satisfies OpenResult;
        if (msg.reset) await deleteIndex(msg.userId);
        const store = new BlockStore(msg.userId, msg.key);
        try {
          const loaded = await store.load();
          for (const d of loaded.docs) this.engine.upsert(d);
          this.store = store;
          return { persisted: true, docs: this.engine.size, crawl: loaded.crawl, lost: loaded.lost, counts: this.engine.channelCounts() } satisfies OpenResult;
        } catch (err) {
          // No disk to keep it on (a private window, storage turned off, a
          // database that will not answer): search still works, in memory.
          console.warn("search index: keeping it in memory only", err);
          store.close();
          this.engine.clear();
          return { persisted: false, docs: 0, crawl: null, lost: [], counts: {} } satisfies OpenResult;
        }
      }
      case "upsert": {
        let changed = false;
        for (const d of msg.docs) {
          if (this.engine.upsert(d) === "same") continue;
          changed = true;
          this.store?.noteUpsert(d);
        }
        return this.mutation(changed);
      }
      case "remove": {
        let changed = false;
        for (const id of msg.ids) {
          if (!this.engine.remove(id)) continue;
          changed = true;
          this.store?.noteRemove(id);
        }
        return this.mutation(changed);
      }
      case "pin": {
        const d = this.engine.get(msg.id);
        if (!d) return this.mutation(false);
        const fl = msg.pinned ? d.fl | 1 : d.fl & ~1;
        if (fl === d.fl) return this.mutation(false);
        const next = { ...d, fl };
        this.engine.upsert(next);
        this.store?.noteUpsert(next);
        return this.mutation(true);
      }
      case "reconcile": {
        // Everything held strictly between the first and the last message of
        // a page the server just sent, and not in that page, has been deleted.
        const present = new Set(msg.present);
        let changed = false;
        for (const id of this.engine.idsBetween(msg.channel, msg.low, msg.high)) {
          if (present.has(id)) continue;
          this.engine.remove(id);
          this.store?.noteRemove(id);
          changed = true;
        }
        return this.mutation(changed);
      }
      case "removeChannel": {
        const gone = this.engine.removeChannel(msg.channel);
        this.store?.noteRemoveChannel(msg.channel);
        return this.mutation(gone.length > 0);
      }
      case "crawl":
        this.store?.setCrawl(msg.state);
        this.schedule();
        return undefined;
      case "query":
        return this.engine.size === 0 ? EMPTY_RESULT : (this.engine.query(msg.req) satisfies EngineResult);
      case "counts":
        return this.engine.channelCounts();
      case "flush":
        await this.flushNow();
        return undefined;
      case "wipe": {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.engine.clear();
        this.store?.close();
        this.store = null;
        if (this.userId) await deleteIndex(this.userId);
        return undefined;
      }
      case "close":
        try {
          await this.flushNow();
        } finally {
          this.store?.close();
          this.store = null;
          this.engine.clear();
        }
        return undefined;
    }
  }
}
