/**
 * Persistent key storage in IndexedDB.
 *
 * Holds the unwrapped identity key pair and the conversation root keys for each
 * signed-in user, so a reload does not have to re-derive anything from the
 * password. Everything here is plaintext at rest inside the browser profile:
 * `clear()` is what a sign-out calls.
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

export const keystore = {
  async saveIdentity(userId: string, id: Identity): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_IDENTITY, "readwrite");
    const value: Identity = { publicKey: id.publicKey, privateKey: id.privateKey };
    tx.objectStore(STORE_IDENTITY).put(value, userId);
    await committed(tx);
  },

  async loadIdentity(userId: string): Promise<Identity | null> {
    const db = await openDb();
    const tx = db.transaction(STORE_IDENTITY, "readonly");
    return asIdentity(await request<unknown>(tx.objectStore(STORE_IDENTITY).get(userId)));
  },

  async saveRoot(userId: string, conv: string, epoch: number, root: Uint8Array): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_ROOTS, "readwrite");
    const value: RootRecord = { userId, conv, epoch, root };
    tx.objectStore(STORE_ROOTS).put(value, rootKeyOf(userId, conv, epoch));
    await committed(tx);
  },

  async loadRoots(userId: string): Promise<StoredRoot[]> {
    const db = await openDb();
    const tx = db.transaction(STORE_ROOTS, "readonly");
    const index = tx.objectStore(STORE_ROOTS).index(INDEX_BY_USER);
    const rows = await request<unknown[]>(index.getAll(userId));
    const out: StoredRoot[] = [];
    for (const row of rows) {
      const parsed = asRoot(row);
      if (parsed) out.push(parsed);
    }
    return out;
  },

  /** Removes only the identity, leaving cached conversation keys in place. */
  async forgetIdentity(userId: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_IDENTITY, "readwrite");
    tx.objectStore(STORE_IDENTITY).delete(userId);
    await committed(tx);
  },

  async clear(userId: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([STORE_IDENTITY, STORE_ROOTS], "readwrite");
    tx.objectStore(STORE_IDENTITY).delete(userId);

    // Delete through a cursor so the whole sweep stays inside one transaction.
    const roots = tx.objectStore(STORE_ROOTS);
    const cursor = roots.index(INDEX_BY_USER).openKeyCursor(IDBKeyRange.only(userId));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      roots.delete(c.primaryKey);
      c.continue();
    };
    await committed(tx);
  },
};
