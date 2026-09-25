import { describe, expect, it } from "vitest";
import { parseQuery, resolveQuery, type SearchCtx } from "@/lib/search";
import type { SearchDoc } from "./doc";
import { SearchEngine, type EngineRequest } from "./engine";

const ctx: SearchCtx = { users: {}, channelNames: { c1: ["general"], c2: ["random"] }, meId: "u1" };

let seq = 1000;
function doc(text: string, extra: Partial<SearchDoc> = {}): SearchDoc {
  seq += 1;
  return { id: String(seq), c: "c1", a: "u1", ts: seq, ed: null, t: text, fl: 0, ...extra };
}

function ask(e: SearchEngine, q: string, over: Partial<EngineRequest> = {}) {
  return e.query({ query: resolveQuery(parseQuery(q), ctx), scope: null, tab: "messages", sort: "newest", offset: 0, limit: 50, ...over });
}

const att = (type: string, name = "f") => ({ blob_id: `b-${name}`, name, type, size: 10, key: "k" });

describe("the engine", () => {
  it("finds words by their beginning, newest first", () => {
    const e = new SearchEngine();
    const a = doc("a needle in the hay");
    const b = doc("needles everywhere");
    e.upsert(doc("only hay here"));
    e.upsert(a);
    e.upsert(b);
    const res = ask(e, "need");
    expect(res.docs.map((d) => d.id)).toEqual([b.id, a.id]);
    expect(res.counts.messages).toBe(2);
    expect(ask(e, "hay needle").docs.map((d) => d.id)).toEqual([a.id]);
    expect(ask(e, "zebra").docs).toEqual([]);
  });

  it("keeps a phrase a phrase and leaves out a word left out", () => {
    const e = new SearchEngine();
    const yes = doc("the quick brown fox");
    e.upsert(yes);
    e.upsert(doc("brown quick"));
    expect(ask(e, '"quick brown"').docs.map((d) => d.id)).toEqual([yes.id]);
    expect(ask(e, "quick -fox").docs).toHaveLength(1);
  });

  it("looks only where it is asked to", () => {
    const e = new SearchEngine();
    const here = doc("plans for the weekend", { c: "dm" });
    e.upsert(here);
    e.upsert(doc("secret staff plans", { c: "staff" }));
    expect(ask(e, "plans", { scope: ["dm"] }).docs.map((d) => d.id)).toEqual([here.id]);
    expect(ask(e, "plans").docs).toHaveLength(2);
    // in: inside a scope that does not hold it finds nothing
    expect(ask(e, "plans in:random", { scope: ["dm"] }).docs).toEqual([]);
  });

  it("goes through everything in a scope when there are only filters", () => {
    const e = new SearchEngine();
    const pic = doc("", { att: [att("image/png")], c: "dm" });
    e.upsert(pic);
    e.upsert(doc("words", { c: "dm" }));
    e.upsert(doc("", { att: [att("image/png")], c: "elsewhere" }));
    expect(ask(e, "has:image", { scope: ["dm"] }).docs.map((d) => d.id)).toEqual([pic.id]);
    expect(ask(e, "has:image").docs).toHaveLength(2);
  });

  it("counts what each tab holds and pages through one", () => {
    const e = new SearchEngine();
    e.upsert(doc("look https://example.com/a", { att: [att("image/png", "1"), att("video/mp4", "2"), att("application/pdf", "3")] }));
    e.upsert(doc("and https://example.org/b https://example.net/c"));
    e.upsert(doc("look at this", { emb: [{ url: "https://tenor.com/x", type: "gif" }] }));
    const res = ask(e, "", { tab: "media" });
    expect(res.counts).toEqual({ messages: 3, media: 3, links: 3, files: 1 });
    expect(res.total).toBe(2);
    const links = ask(e, "", { tab: "links", limit: 1 });
    expect(links.total).toBe(2);
    expect(links.docs).toHaveLength(1);
    const next = ask(e, "", { tab: "links", limit: 1, offset: 1 });
    expect(next.docs[0]!.id).not.toBe(links.docs[0]!.id);
  });

  it("sorts oldest first, and by how well a message matches", () => {
    const e = new SearchEngine();
    const once = doc("a long message that mentions pizza only once among many other words");
    const twice = doc("pizza pizza");
    const prefix = doc("pizzeria");
    e.upsert(once);
    e.upsert(twice);
    e.upsert(prefix);
    expect(ask(e, "pizz", { sort: "oldest" }).docs.map((d) => d.id)).toEqual([once.id, twice.id, prefix.id]);
    expect(ask(e, "pizza", { sort: "relevance" }).docs.map((d) => d.id)).toEqual([twice.id, once.id]);
  });

  it("replaces an edited message and forgets a deleted one", () => {
    const e = new SearchEngine();
    const d = doc("this message will be edited");
    expect(e.upsert(d)).toBe("added");
    expect(e.upsert({ ...d })).toBe("same");
    expect(e.upsert({ ...d, t: "this message was edited", ed: 5 })).toBe("changed");
    expect(ask(e, "will").docs).toEqual([]);
    expect(ask(e, "was").docs.map((x) => x.id)).toEqual([d.id]);
    expect(e.remove(d.id)).toBe(true);
    expect(ask(e, "edited").docs).toEqual([]);
    expect(e.size).toBe(0);
  });

  it("forgets a whole channel and says what went", () => {
    const e = new SearchEngine();
    const a = doc("one", { c: "gone" });
    e.upsert(a);
    e.upsert(doc("two", { c: "stays" }));
    expect(e.removeChannel("gone")).toEqual([a.id]);
    expect(e.channelCounts()).toEqual({ stays: 1 });
  });

  it("stays right after it renumbers itself", () => {
    const e = new SearchEngine();
    const docs = Array.from({ length: 3000 }, (_, i) => doc(`word${i % 7} common`));
    for (const d of docs) e.upsert(d);
    // enough deletions to make it renumber
    for (const d of docs.slice(0, 1500)) e.remove(d.id);
    expect(e.size).toBe(1500);
    expect(ask(e, "common", { limit: 5000 }).counts.messages).toBe(1500);
    expect(ask(e, "word3", { limit: 5000 }).docs.every((d) => d.t.startsWith("word3"))).toBe(true);
  });

  it("leaves out the people it is told to", () => {
    const e = new SearchEngine();
    e.upsert(doc("hello", { a: "blocked" }));
    const kept = doc("hello", { a: "friend" });
    e.upsert(kept);
    expect(ask(e, "hello", { hide: ["blocked"] }).docs.map((d) => d.id)).toEqual([kept.id]);
  });

  it("finds Chinese by its characters and an emoji by the text", () => {
    const e = new SearchEngine();
    const zh = doc("我们去北京大学吧");
    const boot = doc("I'm in! 🥾");
    e.upsert(zh);
    e.upsert(boot);
    expect(ask(e, "北京").docs.map((d) => d.id)).toEqual([zh.id]);
    expect(ask(e, "大学").docs.map((d) => d.id)).toEqual([zh.id]);
    expect(ask(e, "🥾").docs.map((d) => d.id)).toEqual([boot.id]);
  });

  it("answers nothing for a filter that named nobody", () => {
    const e = new SearchEngine();
    e.upsert(doc("hello"));
    expect(ask(e, "hello from:nobody").docs).toEqual([]);
  });
});
