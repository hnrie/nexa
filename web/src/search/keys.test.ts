/**
 * The key that seals the index on this device: made once, opened again only
 * with the same identity key, and gone for good when forgotten.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "@/crypto/bytes";
import { forgetIndexKey, indexKeyFor, wipeSearchIndex } from "./keys";
import { SearchCore, type OpenResult } from "./core";
import { dbName } from "./persist";

// the node test environment has no local storage; a map stands in for it
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

async function roundTrip(key: CryptoKey): Promise<boolean> {
  const iv = new Uint8Array(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("x"));
  return crypto.subtle
    .decrypt({ name: "AES-GCM", iv }, key, ct)
    .then(() => true)
    .catch(() => false);
}

describe("the index key", () => {
  it("is made once and found again with the same identity", async () => {
    const identity = randomBytes(32);
    const first = await indexKeyFor("u1", identity);
    expect(first?.fresh).toBe(true);
    // kept wrapped: what is stored is not the key
    expect(store.get("ec.searchKey.u1")).toBeTruthy();
    const again = await indexKeyFor("u1", identity);
    expect(again?.fresh).toBe(false);
    // the same key: what one sealed, the other opens
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, first!.key, new TextEncoder().encode("hello"));
    expect(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, again!.key, ct))).toBe("hello");
  });

  it("cannot be taken out of the page", async () => {
    const k = await indexKeyFor("u2", randomBytes(32));
    expect(k!.key.extractable).toBe(false);
    expect(await roundTrip(k!.key)).toBe(true);
  });

  it("is not opened by another identity key: a new one is made", async () => {
    await indexKeyFor("u3", randomBytes(32));
    const other = await indexKeyFor("u3", randomBytes(32));
    expect(other?.fresh).toBe(true);
  });

  it("is gone once forgotten, and wiping takes the database too", async () => {
    const identity = randomBytes(32);
    const k = await indexKeyFor("u4", identity);
    const core = new SearchCore();
    await core.handle({ op: "open", userId: "u4", key: k!.key, reset: false });
    await core.handle({ op: "upsert", docs: [{ id: "1", c: "9", a: "7", ts: 1, ed: null, t: "secret", fl: 0 }] });
    await core.handle({ op: "close" });
    forgetIndexKey("u4");
    expect(store.has("ec.searchKey.u4")).toBe(false);
    expect((await indexKeyFor("u4", identity))?.fresh).toBe(true);
    await wipeSearchIndex("u4");
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(dbName("u4"));
    const reopened = (await new SearchCore().handle({ op: "open", userId: "u4", key: k!.key, reset: false })) as OpenResult;
    expect(reopened.docs).toBe(0);
  });
});
