import { describe, expect, it } from "vitest";
import type { PublicUser } from "@/api/types";
import type { SearchDoc } from "@/search/doc";
import { dateRange, filterValue, highlight, isEmptyQuery, isEmptyResolved, matches, needlesOf, parseQuery, resolveQuery, withoutToken, type SearchCtx } from "./search";

const user = (id: string, username: string, display: string): PublicUser => ({ id, username, display_name: display, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0 });
const users = { "1": user("1", "alice", "Alice"), "2": user("2", "bob", "Bob Builder") };
const ctx: SearchCtx = { users, nicknames: { "2": ["bobby"] }, channelNames: { c1: ["general"], c2: ["random"], dm: ["bob", "bob builder", "bobby"] }, meId: "1" };

function doc(id: string, text: string, extra: Partial<SearchDoc> = {}): SearchDoc {
  return { id, c: "c1", a: "1", ts: new Date(2026, 8, 10, 12).getTime(), ed: null, t: text, fl: 0, ...extra };
}

const run = (d: SearchDoc, q: string) => matches(d, resolveQuery(parseQuery(q), ctx));

describe("reading a query", () => {
  it("reads words, phrases, left-out words and every filter", () => {
    const q = parseQuery('hello "big world" from:@alice in:#general has:link -spam mentions:bob pinned:yes');
    expect(q.terms).toEqual(["hello"]);
    expect(q.phrases).toEqual(["big world"]);
    expect(q.from).toEqual(["alice"]);
    expect(q.in).toEqual(["general"]);
    expect(q.has).toEqual(["link"]);
    expect(q.exclude).toEqual(["spam"]);
    expect(q.mentions).toEqual(["bob"]);
    expect(q.pinned).toBe(true);
    expect(q.tokens.map((t) => t.kind)).toEqual(["term", "phrase", "filter", "filter", "filter", "exclude", "filter", "filter"]);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
  });

  it("takes a quoted value for a filter with spaces in it", () => {
    const q = parseQuery('in:"weekend plans" hiking');
    expect(q.in).toEqual(["weekend plans"]);
    expect(q.terms).toEqual(["hiking"]);
    // still being typed: the quote is not closed yet
    expect(parseQuery('in:"weekend pl').in).toEqual(["weekend pl"]);
  });

  it("leaves addresses and times as words", () => {
    expect(parseQuery("https://example.com 12:30").terms).toEqual(["https://example.com", "12:30"]);
  });

  it("marks a filter it cannot read, and does not narrow by it", () => {
    const q = parseQuery("has:unicorn before:banana pinned:maybe");
    expect(q.tokens.every((t) => t.invalid)).toBe(true);
    expect(q.has).toEqual([]);
    expect(q.until).toBeNull();
    expect(q.pinned).toBeNull();
  });

  it("keeps a filter still being typed, with nothing to narrow by yet", () => {
    const q = parseQuery("from:");
    expect(q.tokens).toEqual([{ kind: "filter", key: "from", value: "", start: 0, end: 5 }]);
    expect(isEmptyQuery(q)).toBe(true);
  });
});

describe("dates", () => {
  it("reads a day, a month and a year", () => {
    const day = dateRange("2026-01-31")!;
    expect(new Date(day.start).getDate()).toBe(31);
    expect(new Date(day.end).getDate()).toBe(1);
    const month = dateRange("2026-02")!;
    expect(new Date(month.end).getMonth()).toBe(2);
    const year = dateRange("2025")!;
    expect(new Date(year.end).getFullYear()).toBe(2026);
  });

  it("refuses a date that does not exist rather than rolling it into the next month", () => {
    expect(dateRange("2026-02-30")).toBeNull();
    expect(dateRange("2026-13-01")).toBeNull();
    expect(dateRange("2026-04-31")).toBeNull();
    expect(dateRange("2028-02-29")).not.toBeNull();
  });

  it("before ends where the day starts, after starts where it ends, during is the day", () => {
    const d = dateRange("2026-09-10")!;
    expect(parseQuery("before:2026-09-10").until).toBe(d.start);
    expect(parseQuery("after:2026-09-10").since).toBe(d.end);
    const during = parseQuery("during:2026-09-10");
    expect([during.since, during.until]).toEqual([d.start, d.end]);
    // two date filters leave the time both allow
    const both = parseQuery("after:2026-09-01 before:2026-09-20");
    expect(both.since).toBe(dateRange("2026-09-01")!.end);
    expect(both.until).toBe(dateRange("2026-09-20")!.start);
  });
});

describe("resolving names", () => {
  it("finds people by username, display name, nickname and as me", () => {
    expect(resolveQuery(parseQuery("from:alice"), ctx).from).toEqual(["1"]);
    expect(resolveQuery(parseQuery('from:"bob builder"'), ctx).from).toEqual(["2"]);
    expect(resolveQuery(parseQuery("from:bobby"), ctx).from).toEqual(["2"]);
    expect(resolveQuery(parseQuery("from:me"), ctx).from).toEqual(["1"]);
    // nobody by that name matches nothing, rather than everything
    expect(resolveQuery(parseQuery("from:zed"), ctx).from).toEqual([]);
  });

  it("finds a conversation by the names it answers to", () => {
    expect(resolveQuery(parseQuery("in:bobby"), ctx).channels).toEqual(["dm"]);
    expect(resolveQuery(parseQuery("in:#general"), ctx).channels).toEqual(["c1"]);
  });

  it("folds the words it will look for", () => {
    const r = resolveQuery(parseQuery('Café "ÜBER straße"'), ctx);
    expect(r.terms).toEqual(["cafe"]);
    expect(r.phrases).toEqual(["uber strasse"]);
    expect(isEmptyResolved(resolveQuery(parseQuery(""), ctx))).toBe(true);
  });
});

describe("matching", () => {
  const d1 = doc("1", "Hello big world https://example.com");
  const d2 = doc("2", "spam spam", { a: "2", c: "c2" });
  const sticker = doc("3", "", { st: { id: "s", name: "party parrot" } });
  it("filters by text, author, channel and content", () => {
    expect(run(d1, "hello world")).toBe(true);
    expect(run(d1, '"world hello"')).toBe(false);
    expect(run(d1, "from:alice")).toBe(true);
    expect(run(d1, "from:Bob")).toBe(false);
    expect(run(d2, "in:random")).toBe(true);
    expect(run(d1, "has:link")).toBe(true);
    expect(run(d2, "has:link")).toBe(false);
    expect(run(sticker, "has:sticker")).toBe(true);
    expect(run(sticker, "parrot")).toBe(true);
    expect(run(d2, "-spam")).toBe(false);
    expect(run(d1, "before:2026-09-01")).toBe(false);
    expect(run(d1, "after:2026-09-01")).toBe(true);
    expect(run(d1, "during:2026-09")).toBe(true);
    expect(run(d1, "during:2026-08")).toBe(false);
  });

  it("knows pictures, clips, files and pins", () => {
    const att = (type: string, name = "x") => ({ blob_id: "b", name, type, size: 1, key: "k" });
    const pic = doc("4", "", { att: [att("image/png", "sunset.png")] });
    const clip = doc("5", "", { att: [att("video/mp4")] });
    const pdf = doc("6", "", { att: [att("application/pdf", "notes-for-the-meeting.pdf")], fl: 1 });
    expect(run(pic, "has:image")).toBe(true);
    expect(run(pic, "has:video")).toBe(false);
    expect(run(clip, "has:video")).toBe(true);
    expect(run(pdf, "has:file")).toBe(true);
    expect(run(pic, "has:file")).toBe(true);
    expect(run(pdf, "notes")).toBe(true);
    expect(run(pdf, "pinned:yes")).toBe(true);
    expect(run(pic, "pinned:yes")).toBe(false);
    expect(run(pic, "pinned:no")).toBe(true);
  });

  it("finds mentions of a person and of everyone", () => {
    const m = doc("7", "hey", { mn: ["2"] });
    const all = doc("8", "hey all", { ev: true });
    expect(run(m, "mentions:bob")).toBe(true);
    expect(run(all, "mentions:bob")).toBe(false);
    expect(run(all, "mentions:everyone")).toBe(true);
  });

  it("finds words whatever their accents and case", () => {
    expect(run(doc("9", "Un café à Paris"), "cafe a paris")).toBe(true);
    expect(run(doc("10", "STRASSE"), "straße")).toBe(true);
  });
});

describe("the query as text", () => {
  it("removes one piece and tidies the space", () => {
    const raw = "hello from:bob world";
    const tok = parseQuery(raw).tokens[1]!;
    expect(withoutToken(raw, tok)).toBe("hello world");
    expect(withoutToken("from:bob", parseQuery("from:bob").tokens[0]!)).toBe("");
  });

  it("quotes a value with spaces", () => {
    expect(filterValue("weekend plans")).toBe('"weekend plans"');
    expect(filterValue("general")).toBe("general");
  });
});

describe("highlighting", () => {
  it("marks every word searched for, as written", () => {
    const runs = highlight("Say hello to the world", needlesOf(parseQuery("hello world")));
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["hello", "world"]);
    expect(runs.map((r) => r.text).join("")).toBe("Say hello to the world");
  });

  it("marks an accented word found without its accent", () => {
    const runs = highlight("Un Café noir", needlesOf(parseQuery("cafe")));
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["Café"]);
  });

  it("marks the whole ß a double s was found in", () => {
    const runs = highlight("die Straße", needlesOf(parseQuery("strasse")));
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["Straße"]);
  });
});
