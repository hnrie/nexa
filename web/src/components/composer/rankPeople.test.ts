import { describe, expect, it } from "vitest";
import { rankPeople, recentSpeakers } from "./rankPeople";

const p = (id: string, username: string, display_name = username) => ({ id, username, display_name });
const people = [p("1", "michal", "Michal"), p("2", "alice", "Alice"), p("3", "al", "Al"), p("4", "sally.al", "Sally"), p("5", "bob", "Bob"), p("6", "kalinka", "Kalinka")];
const none = () => "";

describe("rankPeople", () => {
  it("puts an exact name first, then names that start with it, then words that do, then the rest", () => {
    expect(rankPeople("al", people, none, new Map()).map((x) => x.username)).toEqual(["al", "alice", "sally.al", "kalinka", "michal"]);
  });

  it("leads each group with who spoke here most recently", () => {
    const recent = recentSpeakers(["6", "1", "6", "2"]);
    expect([...recent]).toEqual([["6", 0], ["1", 1], ["2", 2]]);
    expect(rankPeople("", people, none, recent).map((x) => x.id).slice(0, 3)).toEqual(["6", "1", "2"]);
    // within the "contains" group, recent speakers first
    expect(rankPeople("al", people, none, recent).map((x) => x.username).slice(3)).toEqual(["kalinka", "michal"]);
  });

  it("matches nicknames, in any script, whatever the case", () => {
    const nick = (id: string) => (id === "5" ? "Сергей" : "");
    expect(rankPeople("серг", people, nick, new Map()).map((x) => x.id)).toEqual(["5"]);
  });

  it("leaves out me when counting who spoke", () => {
    expect([...recentSpeakers(["me", "2", "me"], "me").keys()]).toEqual(["2"]);
  });
});
