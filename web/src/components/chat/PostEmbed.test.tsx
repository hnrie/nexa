// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SocialPost, UnfurlResult } from "@/api/types";
import { resetMediaLinks } from "@/lib/mediaLinks";
import { Embeds } from "./Embeds";

// jsdom has no media playback; a player that goes away pauses its sound
beforeAll(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetMediaLinks();
});

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  platform: "twitter",
  site: "X",
  url: "https://x.com/nasa/status/1",
  name: "NASA",
  handle: "nasa",
  author_url: "https://x.com/nasa",
  avatar: "/media/test/avatar.png",
  text: "New crew soon!",
  created: 1_790_781_346_000,
  ...over,
});

function show(p: SocialPost, card: Partial<UnfurlResult> = {}) {
  const e: UnfurlResult = { url: "https://fxtwitter.com/nasa/status/1", type: "link", title: "NASA", site_name: "X", icon: "/media/test/x.png", post: p, ...card };
  const { container } = render(<Embeds list={[e]} />);
  const root = container.querySelector("[data-testid=post-embed]");
  if (!root) throw new Error("no post card");
  return root as HTMLElement;
}

describe("a social post's card", () => {
  it("is drawn as a post, not as a link's card", () => {
    const card = show(post({ verified: true }));
    expect(card.getAttribute("data-platform")).toBe("twitter");
    expect(card.querySelector("header")?.textContent).toContain("NASA");
    expect(card.textContent).toContain("@nasa");
    expect(card.textContent).toContain("New crew soon!");
    // the author's name leads to the author, the service's chip and the date to the post itself
    const hrefs = [...card.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://x.com/nasa");
    expect(hrefs.filter((h) => h === "https://x.com/nasa/status/1")).toHaveLength(2);
    expect(screen.getByLabelText("Open on X")).toBeTruthy();
    expect(card.textContent).toContain("Verified");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(new Date(1_790_781_346_000).toISOString());
    // and the plain card's title is not drawn a second time
    expect(document.querySelectorAll("a[href='https://fxtwitter.com/nasa/status/1']")).toHaveLength(0);
  });

  it("says each count in words for a screen reader, and in few characters for the eye", () => {
    const card = show(post({ replies: 1, reposts: 1234, likes: 2_100_000, views: 0 }));
    const said = [...card.querySelectorAll("[title]")].map((el) => el.getAttribute("title"));
    expect(said).toContain("1 reply");
    expect(said).toContain("1.2K reposts");
    expect(said).toContain("2.1M likes");
    expect(said.some((s) => s?.includes("view"))).toBe(false);
  });

  it("calls a Reddit post's number points and puts where it was posted first", () => {
    const card = show(post({ platform: "reddit", site: "Reddit", name: "u/someone", handle: undefined, avatar: undefined, community: "r/pics", community_url: "https://www.reddit.com/r/pics/", title: "A headline", likes: 50789, replies: 802 }));
    expect(card.querySelector("header a")?.textContent).toBe("r/pics");
    expect(card.querySelector("header a")?.getAttribute("href")).toBe("https://www.reddit.com/r/pics/");
    expect(card.textContent).toContain("u/someone");
    expect(card.textContent).toContain("A headline");
    expect([...card.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))).toContain("50.8K points");
    // no picture of the author: the service's icon stands in
    expect(card.querySelector("header img")?.getAttribute("src")).toBe("/media/test/x.png");
  });

  it("lays pictures out in a grid, counts the ones past four, and opens them in the viewer", () => {
    const media = Array.from({ length: 6 }, (_, i) => ({ kind: "photo" as const, url: `/media/test/${i}.png`, w: 100, h: 100, ...(i === 0 ? { alt: "The first" } : {}) }));
    const card = show(post({ media }));
    const tiles = card.querySelectorAll("img[role=button]");
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.getAttribute("alt")).toBe("The first");
    expect(tiles[1]?.getAttribute("alt")).toBe("Picture 2 of 6");
    expect(card.textContent).toContain("+2");
    fireEvent.click(tiles[2]!);
    expect(document.querySelector("[role=dialog]")).toBeTruthy();
  });

  it("loads nothing that does not come through this server", () => {
    const card = show(
      post({
        avatar: "https://pbs.twimg.com/avatar.jpg",
        media: [
          { kind: "photo", url: "https://pbs.twimg.com/media/p.jpg", w: 10, h: 10 },
          { kind: "video", url: "https://video.twimg.com/v.mp4", thumb: "https://pbs.twimg.com/t.jpg" },
        ],
      }),
      { icon: "https://abs.twimg.com/favicon.ico" },
    );
    expect(card.querySelectorAll("img, video, audio")).toHaveLength(0);
    // the words are still all there
    expect(card.textContent).toContain("New crew soon!");
  });

  it("plays a video in the app's player, with its sound when that is a file of its own", () => {
    const card = show(post({ platform: "reddit", media: [{ kind: "video", url: "/media/test/v.mp4", thumb: "/media/test/t.png", audio: "/media/test/a.mp4", w: 720, h: 1280, duration: 63 }] }));
    expect(card.querySelector("[data-testid=video-player] video")?.getAttribute("src")).toBe("/media/test/v.mp4");
    expect(card.querySelector("[data-testid=video-player] video")?.getAttribute("poster")).toBe("/media/test/t.png");
    expect(card.querySelector("[data-testid=video-player] audio")?.getAttribute("src")).toBe("/media/test/a.mp4");
  });

  it("shows a video it cannot play as its picture, which opens the post", () => {
    const card = show(post({ platform: "tiktok", site: "TikTok", url: "https://www.tiktok.com/@a/video/1", media: [{ kind: "video", thumb: "/media/test/t.png" }] }));
    const way = screen.getByLabelText("Watch on TikTok");
    expect(way.getAttribute("href")).toBe("https://www.tiktok.com/@a/video/1");
    expect(way.querySelector("img")?.getAttribute("src")).toBe("/media/test/t.png");
    expect(card.querySelector("video")).toBeNull();
  });

  it("loops a silent clip the way a GIF does", () => {
    const card = show(post({ media: [{ kind: "gif", url: "/media/test/g.mp4", thumb: "/media/test/g.png", w: 400, h: 300 }] }));
    const clip = card.querySelector("video") as HTMLVideoElement;
    expect(clip.loop && clip.muted && clip.autoplay).toBe(true);
    expect(card.querySelector("[data-testid=video-player]")).toBeNull();
    expect(card.textContent).toContain("GIF");
  });

  it("covers sensitive media until asked, and leaves the words readable", () => {
    const card = show(post({ sensitive: true, media: [{ kind: "photo", url: "/media/test/p.png", w: 10, h: 10 }] }));
    expect(card.querySelector("[data-covered=true]")).toBeTruthy();
    expect(card.textContent).toContain("This post may have sensitive content.");
    fireEvent.click(screen.getByText("Show"));
    expect(card.querySelector("[data-covered=true]")).toBeNull();
    expect(card.textContent).not.toContain("sensitive content");
  });

  it("draws the post it quotes inside it, the poll, and the readers' note", () => {
    const card = show(
      post({
        reply_to: "Space_Station",
        note: "Readers say otherwise.",
        poll: { choices: [{ label: "Yes", percent: 75, votes: 30 }, { label: "No", percent: 25, votes: 10 }], votes: 40, ends: 1_000 },
        quote: post({ name: "Station", handle: "Space_Station", url: "https://x.com/Space_Station/status/5", text: "Docking soon", replies: 9, media: [{ kind: "photo", url: "/media/test/q.png", w: 10, h: 10 }] }),
      }),
    );
    expect(card.textContent).toContain("Replying to @Space_Station");
    expect(card.textContent).toContain("Readers added context");
    expect(card.textContent).toContain("Readers say otherwise.");
    expect(card.textContent).toContain("Yes");
    expect(card.textContent).toContain("75%");
    expect(card.textContent).toContain("40 votes");
    expect(card.textContent).toContain("Final results");
    expect(card.textContent).toContain("Docking soon");
    // a quote shows who and what, not its counts, and has one way out to it
    expect([...card.querySelectorAll("[title]")].some((el) => el.getAttribute("title") === "9 replies")).toBe(false);
    expect(card.querySelectorAll("a[href='https://x.com/Space_Station/status/5']")).toHaveLength(1);
    expect(card.querySelector("img[src='/media/test/q.png']")).toBeTruthy();
  });

  it("says where a Telegram message was forwarded from, and calls its number reactions", () => {
    const card = show(post({ platform: "telegram", site: "Telegram", community: "Telegram News", community_url: "https://t.me/telegram/100", likes: 2880, views: 873_000 }));
    expect(card.textContent).toContain("Forwarded from Telegram News");
    const said = [...card.querySelectorAll("[title]")].map((el) => el.getAttribute("title"));
    expect(said).toContain("2.9K reactions");
    expect(said).toContain("873K views");
  });

  it("puts the links the server found on their words", () => {
    const card = show(post({ platform: "bluesky", text: "Read example.com/a-lo... now", links: [{ text: "example.com/a-lo...", url: "https://example.com/a-long-address" }] }));
    const a = [...card.querySelectorAll("a")].find((el) => el.textContent === "example.com/a-lo...");
    expect(a?.getAttribute("href")).toBe("https://example.com/a-long-address");
  });

  it("makes do with very little", () => {
    const card = show({ platform: "threads", text: "Just words" });
    expect(card.textContent).toContain("Just words");
    expect(card.querySelector("footer")).toBeTruthy();
    expect(card.querySelector("time")).toBeNull();
  });
});
