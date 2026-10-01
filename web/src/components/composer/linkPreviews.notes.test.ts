// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createLinkPreviews } from "./linkPreviews";

describe("link previews of a note's share link", () => {
  it("asks the server nothing about one, and leaves other links alone", async () => {
    const asked: string[] = [];
    const previews = createLinkPreviews(async (url) => {
      asked.push(url);
      return { url, type: "link", title: "A page" };
    });
    const note = `${location.origin}/note/dG9rZW4tZm9yLWEtbm90ZQ#${"k".repeat(43)}`;
    const got = await previews.embedsFor([note, "https://example.com/page"], 1000);
    expect(asked).toEqual(["https://example.com/page"]);
    expect(got.map((e) => e.url)).toEqual(["https://example.com/page"]);
  });
});
