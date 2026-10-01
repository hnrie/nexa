// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { postText } from "./postText";

afterEach(cleanup);

/** The links a post's text comes out with, as [words, address]. */
function links(text: string, platform: string, given?: { text: string; url: string }[]): [string | null, string | null][] {
  const { container } = render(<p>{postText(text, given, platform)}</p>);
  // the words themselves never change, whatever is made a link
  expect(container.textContent).toBe(text);
  const all = [...container.querySelectorAll("a")];
  expect(all.every((a) => a.target === "_blank" && a.rel === "noopener noreferrer")).toBe(true);
  return all.map((a) => [a.textContent, a.getAttribute("href")]);
}

describe("a post's text", () => {
  it("makes its addresses links and leaves the sentence its punctuation", () => {
    expect(links("see https://example.com/a. and (https://b.test/x) too", "twitter")).toEqual([
      ["https://example.com/a", "https://example.com/a"],
      ["https://b.test/x", "https://b.test/x"],
    ]);
  });

  it("points mentions and hashtags at the site the post is on", () => {
    expect(links("Launch with @Space_Station today! #Artemis #Crew13", "twitter")).toEqual([
      ["@Space_Station", "https://x.com/Space_Station"],
      ["#Artemis", "https://x.com/hashtag/Artemis"],
      ["#Crew13", "https://x.com/hashtag/Crew13"],
    ]);
    expect(links("@some.one #pets", "tiktok")).toEqual([
      ["@some.one", "https://www.tiktok.com/@some.one"],
      ["#pets", "https://www.tiktok.com/tag/pets"],
    ]);
    expect(links("@egg #LikeTheEgg", "instagram")).toEqual([
      ["@egg", "https://www.instagram.com/egg/"],
      ["#LikeTheEgg", "https://www.instagram.com/explore/tags/LikeTheEgg/"],
    ]);
    expect(links("@friend #soon", "threads")).toEqual([
      ["@friend", "https://www.threads.com/@friend"],
      ["#soon", "https://www.threads.com/search?q=soon&serp_type=tags"],
    ]);
  });

  it("reads a tag in any script, and escapes it into the address", () => {
    expect(links("#日本語 #café", "twitter")).toEqual([
      ["#日本語", `https://x.com/hashtag/${encodeURIComponent("日本語")}`],
      ["#café", `https://x.com/hashtag/${encodeURIComponent("café")}`],
    ]);
  });

  it("leaves alone what only looks like a mention or a tag", () => {
    // an email address, a number, a tag in the middle of a word, a mention's trailing full stop
    expect(links("mail me@example.com about #1 and C#sharp, thanks @jack.", "twitter")).toEqual([["@jack", "https://x.com/jack"]]);
    // an address with an anchor and an "@" in it is one link, not three
    expect(links("https://example.com/@user/page#part", "twitter")).toEqual([["https://example.com/@user/page#part", "https://example.com/@user/page#part"]]);
  });

  it("makes no mention or tag links for a site that sends them as links itself", () => {
    expect(links("hello @someone.bsky.social #tag", "bluesky")).toEqual([]);
    expect(links("hello @someone #tag", "mastodon")).toEqual([]);
    expect(links("hello @someone #tag", "a site nobody has heard of")).toEqual([]);
  });

  it("knows Reddit's places and people", () => {
    expect(links("seen in r/pics by u/someone, also /r/aww but not for/real or http", "reddit")).toEqual([
      ["r/pics", "https://www.reddit.com/r/pics/"],
      ["u/someone", "https://www.reddit.com/user/someone"],
      ["/r/aww", "https://www.reddit.com/r/aww/"],
    ]);
    expect(links("r/pics", "twitter")).toEqual([]);
  });

  it("puts the server's links on their words, in order, each after the one before", () => {
    const text = "Read example.com/a-long-pa... and example.com/a-long-pa... again, or #sky";
    expect(
      links(text, "bluesky", [
        { text: "example.com/a-long-pa...", url: "https://example.com/first" },
        { text: "example.com/a-long-pa...", url: "https://example.com/second" },
        { text: "#sky", url: "https://bsky.app/hashtag/sky" },
      ]),
    ).toEqual([
      ["example.com/a-long-pa...", "https://example.com/first"],
      ["example.com/a-long-pa...", "https://example.com/second"],
      ["#sky", "https://bsky.app/hashtag/sky"],
    ]);
  });

  it("skips a link whose words are not there, or whose address is not a web address", () => {
    expect(
      links("one two three", "mastodon", [
        { text: "absent", url: "https://a.test/" },
        { text: "two", url: "javascript:alert(1)" },
        { text: "three", url: "https://a.test/three" },
      ]),
    ).toEqual([["three", "https://a.test/three"]]);
  });

  it("still finds addresses and mentions in the text around the server's links", () => {
    expect(links("@a see the notes at https://b.test/x #tag", "twitter", [{ text: "the notes", url: "https://n.test/" }])).toEqual([
      ["@a", "https://x.com/a"],
      ["the notes", "https://n.test/"],
      ["https://b.test/x", "https://b.test/x"],
      ["#tag", "https://x.com/hashtag/tag"],
    ]);
  });
});
