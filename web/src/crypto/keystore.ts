/**
 * Persistent key storage in IndexedDB.
 *
 * Holds the unwrapped identity key pair and the conversation root keys for each
 * signed-in user, so a reload does not have to re-derive anything from the
 * password. Everything here is plaintext at rest inside the browser profile:
 * `clear()` is what a sign-out calls, and a device with a passcode keeps
 * neither the identity nor any roots here.
 */

import type { Identity } from "./keys";

const DB_NAME = "evilion-chat";
const DB_VERSION = 1;
const STORE_IDENTITY = "identity";
const STORE_ROOTS = "roots";
const INDEX_BY_USER = "byUser";

interface StoredRoot {
  conv: string;
  epoch: number;
  root: Uint8Array;
}

interface RootRecord extends StoredRoot {
  userId: string;
}

let dbHandle: Promise<IDBDatabase> | null = null;

/**
 * How long one piece of work may take. WebKit is known to leave an open, a
 * request or a transaction unanswered for good (after a long stay in the
 * background, or with a database held open by an old tab), and with no limit
 * signing in, reconnecting and signing out each waited on it for ever: the
 * app sat on its spinner, or "ready" with no connection. Past this the work
 * counts as failed, which every caller already copes with.
 */
const DB_TIMEOUT_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("keystore: the database did not answer")), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  dbHandle ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) db.createObjectStore(STORE_IDENTITY);
      if (!db.objectStoreNames.contains(STORE_ROOTS)) {
        const roots = db.createObjectStore(STORE_ROOTS);
        roots.createIndex(INDEX_BY_USER, "userId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("keystore: failed to open database"));
    req.onblocked = () => reject(new Error("keystore: database upgrade blocked"));
  }).catch((err: unknown) => {
    // Let a later call retry rather than caching the failure forever.
    dbHandle = null;
    throw err;
  });
  return dbHandle;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("keystore: request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("keystore: transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("keystore: transaction failed"));
  });
}

function rootKeyOf(userId: string, conv: string, epoch: number): string {
  return `${userId}:${conv}:${epoch}`;
}

/** Structured clone gives back a `Uint8Array`, but be forgiving about the exact view. */
function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

function asIdentity(v: unknown): Identity | null {
  if (typeof v !== "object" || v === null) return null;
  const rec = v as Record<string, unknown>;
  const publicKey = toBytes(rec["publicKey"]);
  const privateKey = toBytes(rec["privateKey"]);
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

function asRoot(v: unknown): StoredRoot | null {
  if (typeof v !== "object" || v === null) return null;
  const rec = v as Record<string, unknown>;
  const conv = rec["conv"];
  const epoch = rec["epoch"];
  const root = toBytes(rec["root"]);
  if (typeof conv !== "string" || typeof epoch !== "number" || !root) return null;
  return { conv, epoch, root };
}

/**
 * Runs one piece of work against the database. A failure drops the cached
 * connection: WebKit loses it after a long stay in the background, and every
 * later call would otherwise fail on the same dead handle.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const handle = openDb();
  try {
    return await withTimeout(
      handle.then((db) => fn(db)),
      DB_TIMEOUT_MS,
    );
  } catch (err) {
    if (dbHandle === handle) dbHandle = null;
    // Dropping the handle is not the same as closing it. Every abandoned
    // connection stays open, and an open connection blocks a version change,
    // so a later DB_VERSION bump would be refused for the life of the tab.
    // Not waited for: a handle that never opened would hold this up for good.
    handle.then(
      (db) => db.close(),
      () => undefined,
    );
    throw err;
  }
}

/** Deletes every root of one user through a cursor, so the sweep stays inside `tx`. */
function deleteRootsIn(tx: IDBTransaction, userId: string): void {
  const roots = tx.objectStore(STORE_ROOTS);
  const cursor = roots.index(INDEX_BY_USER).openKeyCursor(IDBKeyRange.only(userId));
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c) return;
    roots.delete(c.primaryKey);
    c.continue();
  };
}

export const keystore = {
  saveIdentity(userId: string, id: Identity): Promise<void> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_IDENTITY, "readwrite");
      const value: Identity = { publicKey: id.publicKey, privateKey: id.privateKey };
      tx.objectStore(STORE_IDENTITY).put(value, userId);
      await committed(tx);
    });
  },

  loadIdentity(userId: string): Promise<Identity | null> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_IDENTITY, "readonly");
      return asIdentity(await request<unknown>(tx.objectStore(STORE_IDENTITY).get(userId)));
    });
  },

  saveRoot(userId: string, conv: string, epoch: number, root: Uint8Array): Promise<void> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_ROOTS, "readwrite");
      const value: RootRecord = { userId, conv, epoch, root };
      tx.objectStore(STORE_ROOTS).put(value, rootKeyOf(userId, conv, epoch));
      await committed(tx);
    });
  },

  /** Several roots in one transaction: a first sign-in brings every grant the account holds at once. */
  saveRoots(userId: string, roots: StoredRoot[]): Promise<void> {
    if (roots.length === 0) return Promise.resolve();
    return withDb(async (db) => {
      const tx = db.transaction(STORE_ROOTS, "readwrite");
      const store = tx.objectStore(STORE_ROOTS);
      for (const r of roots) {
        const value: RootRecord = { userId, conv: r.conv, epoch: r.epoch, root: r.root };
        store.put(value, rootKeyOf(userId, r.conv, r.epoch));
      }
      await committed(tx);
    });
  },

  loadRoots(userId: string): Promise<StoredRoot[]> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_ROOTS, "readonly");
      const index = tx.objectStore(STORE_ROOTS).index(INDEX_BY_USER);
      const rows = await request<unknown[]>(index.getAll(userId));
      const out: StoredRoot[] = [];
      for (const row of rows) {
        const parsed = asRoot(row);
        if (parsed) out.push(parsed);
      }
      return out;
    });
  },

  /** Removes only the identity, leaving cached conversation keys in place. */
  forgetIdentity(userId: string): Promise<void> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_IDENTITY, "readwrite");
      tx.objectStore(STORE_IDENTITY).delete(userId);
      await committed(tx);
    });
  },

  /**
   * Removes every cached conversation key of one user. A passcode needs this:
   * a root reads its messages without the identity, and the server hands the
   * roots back as grants once the passcode brings the identity back.
   */
  forgetRoots(userId: string): Promise<void> {
    return withDb(async (db) => {
      const tx = db.transaction(STORE_ROOTS, "readwrite");
      deleteRootsIn(tx, userId);
      await committed(tx);
    });
  },

  clear(userId: string): Promise<void> {
    return withDb(async (db) => {
      const tx = db.transaction([STORE_IDENTITY, STORE_ROOTS], "readwrite");
      tx.objectStore(STORE_IDENTITY).delete(userId);
      deleteRootsIn(tx, userId);
      await committed(tx);
    });
  },
};
