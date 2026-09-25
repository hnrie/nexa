/**
 * What this device keeps of the files the account's look points at: the text
 * of each stylesheet loaded from a link, by its address, and the code of each
 * plugin, by its hash. The settings only hold addresses and hashes, so these
 * are what let the app start styled and with its plugins when the sites they
 * came from are slow, down, or out of reach. Signing out empties it.
 */

export interface CachedFile {
  text: string;
  /** When it was fetched, in ms. */
  fetchedAt: number;
}

const DB_NAME = "nexa-look";
const STORE = "files";
/** WebKit sometimes leaves an IndexedDB request unanswered for good; past this it counts as failed. */
const TIMEOUT_MS = 8000;

let handle: Promise<IDBDatabase> | null = null;

function timed<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("look cache: the database did not answer")), TIMEOUT_MS);
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

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no IndexedDB"));
  handle ??= timed(
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("look cache: could not open"));
      req.onblocked = () => reject(new Error("look cache: blocked"));
    }),
  ).catch((err: unknown) => {
    handle = null;
    throw err;
  });
  return handle;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) =>
    timed(
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error("look cache: failed"));
        tx.onabort = () => reject(tx.error ?? new Error("look cache: aborted"));
      }),
    ),
  );
}

export const cssKey = (url: string): string => `css:${url}`;
export const codeKey = (hash: string): string => `code:${hash}`;

/** Never throws: a cache that cannot be read is an empty one. */
export const lookCache = {
  async get(key: string): Promise<CachedFile | null> {
    try {
      const v = (await run("readonly", (s) => s.get(key))) as unknown;
      if (!v || typeof v !== "object") return null;
      const r = v as Record<string, unknown>;
      return typeof r["text"] === "string" && typeof r["fetchedAt"] === "number" ? { text: r["text"], fetchedAt: r["fetchedAt"] } : null;
    } catch {
      return null;
    }
  },
  async put(key: string, file: CachedFile): Promise<void> {
    try {
      await run("readwrite", (s) => s.put(file, key));
    } catch {
      /* the next start fetches it again */
    }
  },
  async delete(key: string): Promise<void> {
    try {
      await run("readwrite", (s) => s.delete(key));
    } catch {
      /* stays until the next sign-out */
    }
  },
  async clear(): Promise<void> {
    try {
      await run("readwrite", (s) => s.clear());
    } catch {
      /* nothing kept, or nothing to reach */
    }
  },
};
