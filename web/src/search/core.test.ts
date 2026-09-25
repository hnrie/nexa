/**
 * The index on disk: what goes in comes back after a restart, sealed, and
 * nothing of it opens without its key or outside its place.
 */
import { describe, expect, it } from "vitest";
import { parseQuery, resolveQuery } from "@/lib/search";
import { SearchCore, type Mutation, type OpenResult } from "./core";
import type { SearchDoc } from "./doc";
import type { EngineResult } from "./engine";
import { BLOCK_SIZE, dbName, deleteIndex } from "./persist";

let users = 0;
const freshUser = () => `9${++users}${Math.floor(Math.random() * 1e6)}`;

async function newKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function doc(id: number, text: string, c = "100"): SearchDoc {
  return { id: String(id), c, a: "7", ts: id, ed: null, t: text, fl: 0 };
}

const ask = (core: SearchCore, q: string) =>
  core.handle({ op: "query", req: { query: resolveQuery(parseQuery(q), { users: {}, channelNames: {} }), scope: null, tab: "messages", sort: "newest", offset: 0, limit: 1000 } }) as Promise<EngineResult>;

async function rawRecords(userId: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName(userId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction("blocks", "readonly").objectStore("blocks").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe("the index on disk", () => {
  it("comes back whole after a restart, with how far the walk had got", async () => {
    const userId = freshUser();
    const key = await newKey();
    const core = new SearchCore();
    await core.handle({ op: "open", userId, key, reset: false });
    const docs = Array.from({ length: BLOCK_SIZE + 50 }, (_, i) => doc(1000 + i, `note number ${i}`));
    await core.handle({ op: "upsert", docs });
    await core.handle({ op: "upsert", docs: [doc(5000, "something about pizza", "200")] });
    await core.handle({ op: "crawl", state: { v: 1, channels: { "100": { newest: "1249", done: true } } } });
    await core.handle({ op: "close" });

    const again = new SearchCore();
    const opened = (await again.handle({ op: "open", userId, key, reset: false })) as OpenResult;
    expect(opened.persisted).toBe(true);
    expect(opened.docs).toBe(BLOCK_SIZE + 51);
    expect(opened.crawl).toEqual({ v: 1, channels: { "100": { newest: "1249", done: true } } });
    expect(opened.counts).toEqual({ "100": BLOCK_SIZE + 50, "200": 1 });
    expect((await ask(again, "pizza")).docs.map((d) => d.id)).toEqual(["5000"]);
    await again.handle({ op: "close" });
  });

  it("keeps nothing readable on disk", async () => {
    const userId = freshUser();
    const core = new SearchCore();
    await core.handle({ op: "open", userId, key: await newKey(), reset: false });
    await core.handle({ op: "upsert", docs: [doc(1, "the secret word is marmalade")] });
    await core.handle({ op: "flush" });
    const records = await rawRecords(userId);
    expect(records).toHaveLength(1);
    const bytes = new Uint8Array((records[0] as { ct: ArrayBuffer }).ct);
    expect(new TextDecoder().decode(bytes)).not.toContain("marmalade");
    await core.handle({ op: "close" });
  });

  it("opens nothing with another key, and starts afresh", async () => {
    const userId = freshUser();
    const core = new SearchCore();
    await core.handle({ op: "open", userId, key: await newKey(), reset: false });
    await core.handle({ op: "upsert", docs: [doc(1, "hello")] });
    await core.handle({ op: "close" });

    const other = new SearchCore();
    const opened = (await other.handle({ op: "open", userId, key: await newKey(), reset: false })) as OpenResult;
    expect(opened.docs).toBe(0);
    // the conversation whose history could not be read is walked again
    expect(opened.lost).toEqual(["100"]);
    await other.handle({ op: "close" });
  });

  it("writes edits and deletions through, and a whole conversation going", async () => {
    const userId = freshUser();
    const key = await newKey();
    const core = new SearchCore();
    await core.handle({ op: "open", userId, key, reset: false });
    await core.handle({ op: "upsert", docs: [doc(1, "first draft"), doc(2, "delete me"), doc(3, "elsewhere", "200")] });
    const edited: SearchDoc = { ...doc(1, "final version"), ed: 99 };
    expect(((await core.handle({ op: "upsert", docs: [edited] })) as Mutation).changed).toBe(true);
    await core.handle({ op: "remove", ids: ["2"] });
    await core.handle({ op: "pin", id: "1", pinned: true });
    await core.handle({ op: "removeChannel", channel: "200" });
    await core.handle({ op: "close" });

    const again = new SearchCore();
    await again.handle({ op: "open", userId, key, reset: false });
    expect((await ask(again, "draft")).docs).toEqual([]);
    expect((await ask(again, "final pinned:yes")).docs.map((d) => d.id)).toEqual(["1"]);
    expect((await ask(again, "delete")).docs).toEqual([]);
    expect((await ask(again, "elsewhere")).docs).toEqual([]);
    await again.handle({ op: "close" });
  });

  it("forgets what a page from the server no longer has", async () => {
    const core = new SearchCore();
    await core.handle({ op: "open", userId: freshUser(), key: null, reset: false });
    await core.handle({ op: "upsert", docs: [doc(10, "a"), doc(11, "b"), doc(12, "c"), doc(13, "d")] });
    // the server's page runs from 10 to 13 and 11 is not in it: it was deleted
    const m = (await core.handle({ op: "reconcile", channel: "100", low: "10", high: "13", present: ["10", "12", "13"] })) as Mutation;
    expect(m).toEqual({ docs: 3, changed: true });
  });

  it("is gone once deleted, and a reset starts from nothing", async () => {
    const userId = freshUser();
    const key = await newKey();
    const core = new SearchCore();
    await core.handle({ op: "open", userId, key, reset: false });
    await core.handle({ op: "upsert", docs: [doc(1, "hello")] });
    await core.handle({ op: "wipe" });
    const again = new SearchCore();
    expect(((await again.handle({ op: "open", userId, key, reset: false })) as OpenResult).docs).toBe(0);
    await again.handle({ op: "upsert", docs: [doc(2, "hi")] });
    await again.handle({ op: "close" });
    const reset = new SearchCore();
    expect(((await reset.handle({ op: "open", userId, key, reset: true })) as OpenResult).docs).toBe(0);
    await reset.handle({ op: "close" });
    await deleteIndex(userId);
  });

  it("keeps the index in memory when told to keep nothing", async () => {
    const userId = freshUser();
    const core = new SearchCore();
    const opened = (await core.handle({ op: "open", userId, key: null, reset: false })) as OpenResult;
    expect(opened.persisted).toBe(false);
    await core.handle({ op: "upsert", docs: [doc(1, "only here")] });
    expect((await ask(core, "only")).docs).toHaveLength(1);
    await core.handle({ op: "close" });
    const again = new SearchCore();
    await again.handle({ op: "open", userId, key: null, reset: false });
    expect((await ask(again, "only")).docs).toHaveLength(0);
  });
});
