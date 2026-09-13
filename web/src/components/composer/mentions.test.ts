import { describe, expect, it } from "vitest";
import type { PublicUser } from "@/api/types";
import { extractMentions } from "./mentions";

const users = { "42": { id: "42", username: "alex", display_name: "Alex" } as PublicUser };

describe("extractMentions", () => {
  it("turns a known @name into a mention", () => {
    expect(extractMentions("hi @alex!", users)).toEqual({ text: "hi <@42>!", mentions: ["42"], everyone: false });
  });

  it("leaves @names inside links and code alone", () => {
    const text = "watch https://youtube.com/@alex and <https://x.com/@alex> or `@alex`";
    expect(extractMentions(text, users)).toEqual({ text, mentions: [], everyone: false });
  });

  it("still finds a mention right after a link", () => {
    expect(extractMentions("https://example.com/a @alex", users).text).toBe("https://example.com/a <@42>");
  });
});
