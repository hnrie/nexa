/**
 * The search index on this device's disk.
 *
 * Decrypted messages are kept in IndexedDB so a reload finds everything
 * searchable at once instead of fetching and decrypting it all again. They are
 * never kept in the clear: messages are stored in blocks of up to BLOCK_SIZE
 * per conversation, each block sealed with AES-GCM under a key of this device
 * and account (search/keys.ts), and bound to its place so a block cannot be
 * moved to another conversation or account and still open.
 *
 * Blocks are filled in the order messages arrive, not by date: the whole index
 * is read into memory when it opens, so where a message sits on disk only
 * matters for finding it again when it changes, which the map below does.
 *
 * Plain IndexedDB and WebCrypto, so it runs in the search worker.
 */
import type { SearchDoc } from "./doc";

export const BLOCK_SIZE = 200;
const DB_VERSION = 1;
const STORE_BLOCKS = "blocks";
const STORE_META = "meta";
const CRAWL_KEY = "crawl";

/**
 * How long one piece of work may take. WebKit is known to leave an open, a
 * request or a transaction unanswered for good (crypto/keystore.ts has the
 * story); past this it counts as failed and search carries on in memory.
 */
const DB_TIMEOUT_MS = 20_000;

export function dbName(userId: string): string {
  return `nexa-search-${userId}`;
}

interface BlockRecord {
  /** `${channel}:${n}` */
  k: string;
  ch: string;
  n: number;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

interface SealedRecord {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

interface Block {
  ch: string;
  n: number;
  ids: Set<string>;
}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`search index: ${what} did not answer`)), DB_TIMEOUT_MS);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("search index: request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("search index: transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("search index: transaction failed"));
  });
}

function openDb(name: string): Promise<IDBDatabase> {
  return withTimeout(
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BLOCKS)) db.createObjectStore(STORE_BLOCKS, { keyPath: "k" });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("search index: could not open"));
      req.onblocked = () => reject(new Error("search index: blocked by another tab"));
    }),
    "opening",
  );
}

/** Deletes an account's index from this device. Never throws. */
export async function deleteIndex(userId: string): Promise<void> {
  try {
    await withTimeout(
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(dbName(userId));
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        // Another tab still has it open. It closes its copy when it sees the
        // version change (onversionchange below), and the delete then goes ahead.
        req.onblocked = () => undefined;
      }),
      "deleting",
    );
  } catch {
    /* the key that opens it is already gone (search/keys.ts), so what is left cannot be read */
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function aad(userId: string, where: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`nexa-search/1|${userId}|${where}`);
}

async function seal(key: CryptoKey, userId: string, where: string, value: unknown): Promise<SealedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(userId, where) }, key, enc.encode(JSON.stringify(value)));
  return { iv, ct };
}

async function open<T>(key: CryptoKey, userId: string, where: string, rec: SealedRecord): Promise<T> {
  const iv = new Uint8Array(rec.iv);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(userId, where) }, key, rec.ct);
  return JSON.parse(dec.decode(plain)) as T;
}

function isDoc(v: unknown): v is SearchDoc {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d["id"] === "string" && typeof d["c"] === "string" && typeof d["a"] === "string" && typeof d["ts"] === "number" && typeof d["t"] === "string";
}

export interface Loaded {
  docs: SearchDoc[];
  crawl: unknown;
  /** Conversations with a block that could not be read, whose history has to be fetched again. */
  lost: string[];
}

/**
 * Where every message sits on disk, and what has changed since the last write.
 * All writes wait for `flush`, which puts them in one transaction: a crawl's
 * progress is never saved ahead of the messages it walked past.
 */
export class BlockStore {
  private db: IDBDatabase | null = null;
  private readonly blocks = new Map<string, Block>();
  private readonly blockOf = new Map<string, string>();
  /** The block of each conversation that new messages go into. */
  private readonly filling = new Map<string, string>();
  private readonly nextN = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private crawl: unknown = null;
  private crawlDirty = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly userId: string,
    private readonly key: CryptoKey,
  ) {}

  /** Opens the index and reads all of it. */
  async load(): Promise<Loaded> {
    const db = await openDb(dbName(this.userId));
    this.db = db;
    // another tab deleting the index (a sign-out there) must not wait on this one
    db.onversionchange = () => {
      db.close();
      this.db = null;
    };
    const tx = db.transaction([STORE_BLOCKS, STORE_META], "readonly");
    const [records, crawlRec] = await withTimeout(Promise.all([request(tx.objectStore(STORE_BLOCKS).getAll()), request(tx.objectStore(STORE_META).get(CRAWL_KEY))]), "reading");
    const docs = new Map<string, SearchDoc>();
    const lost = new Set<string>();
    const broken: string[] = [];
    const ordered = (records as BlockRecord[]).filter((r) => typeof r?.k === "string" && typeof r.ch === "string").sort((a, b) => a.n - b.n);
    // Read a few blocks at a time: each is one decryption and one parse, and
    // this runs while someone may already be waiting on a search.
    for (let i = 0; i < ordered.length; i += 16) {
      const part = ordered.slice(i, i + 16);
      const opened = await Promise.all(part.map((r) => open<unknown>(this.key, this.userId, r.k, r).then((v) => (Array.isArray(v) ? v : null), () => null)));
      part.forEach((r, j) => {
        const list = opened[j];
        this.nextN.set(r.ch, Math.max(this.nextN.get(r.ch) ?? 0, r.n + 1));
        if (!list) {
          lost.add(r.ch);
          broken.push(r.k);
          return;
        }
        const block: Block = { ch: r.ch, n: r.n, ids: new Set() };
        for (const d of list) {
          if (!isDoc(d) || d.c !== r.ch) continue;
          const had = this.blockOf.get(d.id);
          // a message found in two blocks (a write cut off halfway) keeps the later copy
          if (had) {
            this.blocks.get(had)?.ids.delete(d.id);
            this.dirty.add(had);
          }
          docs.set(d.id, d);
          block.ids.add(d.id);
          this.blockOf.set(d.id, r.k);
        }
        this.blocks.set(r.k, block);
        if (block.ids.size < BLOCK_SIZE) this.filling.set(r.ch, r.k);
      });
    }
    for (const k of broken) {
      // gone from disk at the next write, and its conversation walked again
      this.blocks.set(k, { ch: k.split(":")[0] ?? "", n: -1, ids: new Set() });
      this.dirty.add(k);
    }
    let crawl: unknown = null;
    if (crawlRec) {
      try {
        crawl = await open<unknown>(this.key, this.userId, CRAWL_KEY, crawlRec as SealedRecord);
      } catch {
        crawl = null;
      }
    }
    this.crawl = crawl;
    this.compactSparse();
    return { docs: [...docs.values()], crawl, lost: [...lost] };
  }

  /**
   * Repacks a conversation whose blocks have mostly emptied (a lot deleted),
   * so opening the index does not read hundreds of near-empty blocks.
   */
  private compactSparse(): void {
    const perChannel = new Map<string, Block[]>();
    for (const b of this.blocks.values()) {
      if (b.n < 0) continue;
      const list = perChannel.get(b.ch) ?? [];
      list.push(b);
      perChannel.set(b.ch, list);
    }
    for (const [ch, list] of perChannel) {
      const count = list.reduce((n, b) => n + b.ids.size, 0);
      if (list.length <= Math.ceil(count / BLOCK_SIZE) * 2 + 2) continue;
      const ids = list.flatMap((b) => [...b.ids]);
      for (const b of list) {
        const k = `${ch}:${b.n}`;
        b.ids.clear();
        this.dirty.add(k);
      }
      this.filling.delete(ch);
      for (const id of ids) this.place(ch, id);
    }
  }

  private place(ch: string, id: string): void {
    let k = this.filling.get(ch);
    let block = k ? this.blocks.get(k) : undefined;
    if (!k || !block || block.ids.size >= BLOCK_SIZE) {
      const n = this.nextN.get(ch) ?? 0;
      this.nextN.set(ch, n + 1);
      k = `${ch}:${n}`;
      block = { ch, n, ids: new Set() };
      this.blocks.set(k, block);
      this.filling.set(ch, k);
    }
    block.ids.add(id);
    this.blockOf.set(id, k);
    this.dirty.add(k);
  }

  /** A message added or changed. */
  noteUpsert(d: SearchDoc): void {
    const k = this.blockOf.get(d.id);
    if (k) this.dirty.add(k);
    else this.place(d.c, d.id);
  }

  /** A message gone. */
  noteRemove(id: string): void {
    const k = this.blockOf.get(id);
    if (!k) return;
    this.blockOf.delete(id);
    this.blocks.get(k)?.ids.delete(id);
    this.dirty.add(k);
  }

  /** A whole conversation gone. */
  noteRemoveChannel(ch: string): void {
    for (const [k, b] of this.blocks) {
      if (b.ch !== ch) continue;
      for (const id of b.ids) this.blockOf.delete(id);
      b.ids.clear();
      this.dirty.add(k);
    }
    this.filling.delete(ch);
  }

  setCrawl(state: unknown): void {
    this.crawl = state;
    this.crawlDirty = true;
  }

  get pending(): boolean {
    return this.dirty.size > 0 || this.crawlDirty;
  }

  /**
   * Writes everything changed, in one transaction. Sealing happens first,
   * because a transaction left waiting on a promise commits on its own.
   * Writes queue behind each other, so two flushes never interleave.
   */
  flush(get: (id: string) => SearchDoc | undefined): Promise<void> {
    const run = this.writing.then(() => this.write(get));
    this.writing = run.catch(() => undefined);
    return run;
  }

  private async write(get: (id: string) => SearchDoc | undefined): Promise<void> {
    const db = this.db;
    if (!db || !this.pending) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    const crawl = this.crawlDirty ? this.crawl : undefined;
    this.crawlDirty = false;
    const puts: BlockRecord[] = [];
    const deletes: string[] = [];
    try {
      for (const k of keys) {
        const b = this.blocks.get(k);
        const docs = b ? [...b.ids].map(get).filter((d): d is SearchDoc => d !== undefined) : [];
        if (!b || docs.length === 0) {
          deletes.push(k);
          if (b && b.ids.size === 0) {
            this.blocks.delete(k);
            if (this.filling.get(b.ch) === k) this.filling.delete(b.ch);
          }
          continue;
        }
        const sealed = await seal(this.key, this.userId, k, docs);
        puts.push({ k, ch: b.ch, n: b.n, iv: sealed.iv, ct: sealed.ct });
      }
      const sealedCrawl = crawl !== undefined ? await seal(this.key, this.userId, CRAWL_KEY, crawl) : null;
      const tx = db.transaction([STORE_BLOCKS, STORE_META], "readwrite");
      const blocks = tx.objectStore(STORE_BLOCKS);
      for (const r of puts) blocks.put(r);
      for (const k of deletes) blocks.delete(k);
      if (sealedCrawl) tx.objectStore(STORE_META).put(sealedCrawl, CRAWL_KEY);
      await withTimeout(committed(tx), "writing");
    } catch (err) {
      // tried again with the next write
      for (const k of keys) this.dirty.add(k);
      if (crawl !== undefined && !this.crawlDirty) this.crawlDirty = true;
      throw err;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
