import { describe, expect, it } from "vitest";
import type { Channel, PublicUser } from "@/api/types";
import type { Names } from "./scope";
import { flat, partialAt, replacePiece, suggest, type SuggestInput } from "./suggest";

const user = (id: string, username: string, display: string): PublicUser => ({ id, username, display_name: display, avatar_id: null, banner_id: null, about_me: "", pronouns: "", accent_color: null, accent_color_2: null, status_text: "", status_emoji: "", status_expires_at: null, public_key: "", flags: 0, created_at: 0 });
const users = { "1": user("1", "alice", "Alice"), "2": user("2", "bob", "Bob Builder"), "3": user("3", "carol", "Carol") };
const general = { id: "g", server_id: "s", type: "text", name: "general", recipient_ids: [] } as unknown as Channel;
const plans = { id: "p", server_id: "s", type: "text", name: "weekend plans", recipient_ids: [] } as unknown as Channel;
const dm = { id: "d", server_id: null, type: "dm", name: "", recipient_ids: ["1", "2"] } as unknown as Channel;
const names: Names = {
  users,
  meId: "1",
  person: (id) => users[id as keyof typeof users]?.display_name ?? "?",
  channel: (ch) => (ch.server_id ? `#${ch.name}` : "Bob Builder"),
  serverName: () => "Nexa Design Lab",
  ctx: { users, nicknames: { "2": ["bobby"] }, channelNames: { g: ["general"], p: ["weekend plans"], d: ["bob", "bob builder", "bobby"] }, meId: "1" },
};

function input(raw: string, over: Partial<SuggestInput> = {}): SuggestInput {
  return { raw, caret: raw.length, names, channels: [dm, general, plans], nearby: ["1", "2"], recent: ["pizza", "from:bob has:image"], now: new Date(2026, 8, 25, 15).getTime(), ...over };
}

const texts = (raw: string, over?: Partial<SuggestInput>) => flat(suggest(input(raw, over))).map((s) => s.text);

describe("the piece under the caret", () => {
  it("finds the filter being typed, and a plain word", () => {
    expect(partialAt("hello from:al", 13)).toEqual({ key: "from", value: "al", start: 6, end: 13 });
    expect(partialAt("in:gen", 6)).toEqual({ key: "in", value: "gen", start: 0, end: 6 });
    expect(partialAt("hello", 5)).toEqual({ key: null, value: "hello", start: 0, end: 5 });
    // a space after it: nothing is being typed
    expect(partialAt("from:alice ", 11)).toBeNull();
  });

  it("puts a finished filter in with a space after it, and keeps what follows", () => {
    expect(replacePiece("hello from:al", { start: 6, end: 13 }, "from:alice", true)).toEqual({ text: "hello from:alice ", caret: 17 });
    expect(replacePiece("from:al world", { start: 0, end: 7 }, "from:alice", true)).toEqual({ text: "from:alice world", caret: 11 });
    expect(replacePiece("fr", { start: 0, end: 2 }, "from:", false)).toEqual({ text: "from:", caret: 5 });
  });
});

describe("suggestions", () => {
  it("offers the last searches and every filter in an empty box", () => {
    const groups = suggest(input(""));
    expect(groups.map((g) => g.kind)).toEqual(["recent", "keys"]);
    expect(groups[0]!.items.map((s) => s.text)).toEqual(["pizza", "from:bob has:image"]);
    expect(groups[1]!.items.map((s) => s.text)).toContain("during:");
  });

  it("offers people for from:, yourself first, by any of their names", () => {
    expect(texts("from:")).toEqual(["from:me ", "from:bob ", "from:carol "]);
    expect(texts("from:bui")).toEqual(["from:bob "]);
    expect(texts("from:bobby")).toEqual(["from:bob "]);
    expect(texts("mentions:ev")).toEqual(["mentions:everyone "]);
  });

  it("offers conversations for in:, quoting a name with a space", () => {
    expect(texts("in:gen")).toEqual(["in:general "]);
    expect(texts("in:week")).toEqual(['in:"weekend plans" ']);
    // a DM goes in by its person's username
    expect(texts("in:bob")).toEqual(["in:bob "]);
  });

  it("offers kinds, pins and dates", () => {
    expect(texts("has:im")).toEqual(["has:image "]);
    expect(texts("pinned:")).toEqual(["pinned:yes ", "pinned:no "]);
    const dates = flat(suggest(input("during:"))).map((s) => s.value ?? s.kind);
    expect(dates).toEqual(["2026-09-25", "2026-09-24", "2026-09", "2026-08", "2026", "pickDate"]);
    expect(texts("before:2026-08")).toContain("before:2026-08 ");
  });

  it("offers the filters a word starts, and the person or conversation it names", () => {
    const groups = suggest(input("fr"));
    expect(groups[0]!.kind).toBe("keys");
    expect(groups[0]!.items[0]).toMatchObject({ text: "from:", caret: 5 });
    const named = flat(suggest(input("pizza bo")));
    expect(named.map((s) => s.text)).toEqual(["pizza from:bob ", "pizza in:bob "]);
  });

  it("follows the caret into a filter in the middle of the query", () => {
    const raw = "cats from:ca has:image";
    expect(texts(raw, { caret: 12 })).toEqual(["cats from:carol has:image"]);
  });
});
