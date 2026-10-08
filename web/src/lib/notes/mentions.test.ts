import { describe, expect, it } from "vitest";
import type { PublicUser } from "@/api/types";
import { mentionMatches, mentionedIds } from "./mentions";

const user = (id: string, username: string, display_name: string): PublicUser => ({ id, username, display_name, avatar_id: null }) as PublicUser;

const people = [user("1", "alice", "Alice Lind"), user("2", "bob", "Bob"), user("3", "mika_k", "Mika"), user("4", "zoe", "Zoë Calice")];

describe("mentioning people in a note", () => {
  it("offers everyone, alphabetically, before anything is typed", () => {
    expect(mentionMatches(people, "").map((u) => u.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("puts names that start with it first, then words that do, then names that have it", () => {
    expect(mentionMatches(people, "li").map((u) => u.id)).toEqual(["1", "4"]);
    expect(mentionMatches(people, "lin").map((u) => u.id)).toEqual(["1"]);
    expect(mentionMatches(people, "cal").map((u) => u.id)).toEqual(["4"]);
    expect(mentionMatches(people, "k").map((u) => u.id)).toEqual(["3"]);
  });

  it("matches usernames and ignores case", () => {
    expect(mentionMatches(people, "MIKA_").map((u) => u.id)).toEqual(["3"]);
    expect(mentionMatches(people, "BO").map((u) => u.id)).toEqual(["2"]);
  });

  it("offers nobody for what nobody's name has, and at most max", () => {
    expect(mentionMatches(people, "xyz")).toEqual([]);
    expect(mentionMatches(people, "", 2)).toHaveLength(2);
  });

  it("finds who the text mentions, once each", () => {
    expect(mentionedIds("hi <@12> and <@!34>, also <@12> but not <@&56> or <#78>")).toEqual(["12", "34"]);
  });
});
