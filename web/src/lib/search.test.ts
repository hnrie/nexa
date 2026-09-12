import { describe, expect, it } from "vitest";
import type { PublicUser } from "@/api/types";
import type { DecryptedMessage } from "@/lib/decrypt";
import { highlight, isEmptyQuery, matches, parseQuery, search } from "./search";

const user = (id: string, username: string, display: string): PublicUser => ({ id, username, display_name: display, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0 });
const users = { "1": user("1", "alice", "Alice"), "2": user("2", "bob", "Bob") };
const ctx = { users, channelNames: { c1: "general", c2: "random" } };

function msg(id: string, text: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id,
    channel_id: "c1",
    author_id: "1",
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: Date.parse("2026-09-10T12:00:00Z"),
    payload: { t: text },
    ...extra,
  } as DecryptedMessage;
}

describe("search query parsing", () => {
  it("parses filters, phrases and exclusions", () => {
    const q = parseQuery('hello "big world" from:@alice in:#general has:link -spam before:2026-09-11 after:2026-09-01 mentions:bob');
    expect(q.terms).toEqual(["hello"]);
    expect(q.phrases).toEqual(["big world"]);
    expect(q.from).toEqual(["alice"]);
    expect(q.in).toEqual(["general"]);
    expect(q.has).toEqual(["link"]);
    expect(q.exclude).toEqual(["spam"]);
    expect(q.mentions).toEqual(["bob"]);
    expect(q.before).not.toBeNull();
    expect(q.after).not.toBeNull();
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(parseQuery("has:nope").has).toEqual([]);
  });
});

describe("matching", () => {
  const m1 = msg("1", "Hello big world https://example.com");
  const m2 = msg("2", "spam spam", { author_id: "2", channel_id: "c2" });
  const m3 = msg("3", "", { payload: { sticker: { id: "s" } } });
  it("filters by text, author, channel and content", () => {
    expect(matches(m1, parseQuery("hello world"), ctx)).toBe(true);
    expect(matches(m1, parseQuery('"world hello"'), ctx)).toBe(false);
    expect(matches(m1, parseQuery("from:alice"), ctx)).toBe(true);
    expect(matches(m1, parseQuery("from:Bob"), ctx)).toBe(false);
    expect(matches(m2, parseQuery("in:random"), ctx)).toBe(true);
    expect(matches(m1, parseQuery("has:link"), ctx)).toBe(true);
    expect(matches(m2, parseQuery("has:link"), ctx)).toBe(false);
    expect(matches(m3, parseQuery("has:sticker"), ctx)).toBe(true);
    expect(matches(m2, parseQuery("-spam"), ctx)).toBe(false);
    expect(matches(m1, parseQuery("before:2026-09-01"), ctx)).toBe(false);
    expect(matches(m1, parseQuery("after:2026-09-01"), ctx)).toBe(true);
    expect(matches(msg("4", "x", { type: "system_join" }), parseQuery("x"), ctx)).toBe(false);
  });
  it("sorts results newest first and highlights hits", () => {
    const older = msg("5", "hello again", { created_at: 1 });
    const res = search([older, m1, m2], parseQuery("hello"), ctx);
    expect(res.map((m) => m.id)).toEqual(["1", "5"]);
    const runs = highlight("Say hello to the world", parseQuery("hello world"));
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(["hello", "world"]);
    expect(runs.map((r) => r.text).join("")).toBe("Say hello to the world");
  });
});
