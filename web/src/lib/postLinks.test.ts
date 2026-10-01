import { describe, expect, it } from "vitest";
import { isPostLink } from "./postLinks";

describe("isPostLink", () => {
  it("knows the services whose posts get a card of their own, and the domains that stand in for them", () => {
    for (const link of [
      "https://x.com/jack/status/20",
      "https://twitter.com/jack/status/20",
      "https://fxtwitter.com/jack/status/20",
      "https://d.fxtwitter.com/jack/status/20",
      "https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l",
      "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      "https://vm.tiktok.com/ZMabc123/",
      "https://www.instagram.com/p/BsOGulcndj-/",
      "https://old.reddit.com/r/pics/comments/92dd8/x/",
      "https://redd.it/92dd8",
      "https://t.me/durov/43",
      "https://www.threads.com/@zuck/post/DXhZAMkljvS",
      "HTTPS://X.COM/jack/status/20",
    ]) {
      expect(isPostLink(link), link).toBe(true);
    }
  });

  it("knows a Mastodon post by the shape of its address, on any server", () => {
    expect(isPostLink("https://mastodon.social/@Mastodon/117156549508722805")).toBe(true);
    expect(isPostLink("https://hachyderm.io/@someone@mastodon.social/117156549508722805")).toBe(true);
    expect(isPostLink("https://example.social/users/someone/statuses/117156549508722805")).toBe(true);
    expect(isPostLink("https://medium.com/@writer/a-story-1234567890ab")).toBe(false);
  });

  it("is not fooled by a picture host, a stranger, or something that is not an address", () => {
    for (const link of ["https://i.redd.it/abc.jpeg", "https://v.redd.it/abc", "https://example.com/jack/status/20", "https://notx.com.evil.test/a", "ftp://x.com/jack/status/20", "x.com/jack", "", "https://telegram.org/blog"]) {
      expect(isPostLink(link), link).toBe(false);
    }
  });
});
