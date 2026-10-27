// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UnfurlResult } from "@/api/types";
import { Embeds, linkify, siteAccount } from "./Embeds";

afterEach(cleanup);

describe("linkify", () => {
  it("makes the addresses in a page's words links, and leaves the sentence its punctuation", () => {
    const { container } = render(<p>{linkify("see https://example.com/a. and (https://b.test/x) too")}</p>);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/a", "https://b.test/x"]);
    expect(links.every((a) => a.target === "_blank" && a.rel === "noopener noreferrer")).toBe(true);
    expect(container.textContent).toBe("see https://example.com/a. and (https://b.test/x) too");
  });

  it("leaves words without an address as they are", () => {
    expect(linkify("nothing to see here, not even ftp://x.test")).toEqual(["nothing to see here, not even ftp://x.test"]);
  });
});

describe("a link's card", () => {
  const card = (over: Partial<UnfurlResult>): UnfurlResult => ({ url: "https://example.com/post", type: "link", title: "A post", image: "/media/test/cover.png", ...over });
  const picture = (over: Partial<UnfurlResult>) => {
    const { container } = render(<Embeds list={[card(over)]} />);
    return container.querySelector("img[data-image-src]")?.className;
  };

  it("keeps the description's line breaks and makes its addresses links", () => {
    const { container } = render(<Embeds list={[card({ description: "first line\nsecond line https://x.test/y" })]} />);
    const desc = container.querySelector(".desc") as HTMLElement;
    expect(desc.textContent).toBe("first line\nsecond line https://x.test/y");
    expect(desc.querySelector("a")?.getAttribute("href")).toBe("https://x.test/y");
  });

  it("shows the picture as large or as a thumbnail, as the page asks", () => {
    expect(picture({ image_layout: "large", image_w: 200, image_h: 200 })).toBe("large");
    expect(picture({ image_layout: "thumbnail", image_w: 1200, image_h: 630 })).toBe("thumb");
  });

  it("decides by the picture's size when the page does not say", () => {
    expect(picture({ image_w: 1200, image_h: 630 })).toBe("large");
    expect(picture({ image_w: 200, image_h: 200 })).toBe("thumb");
    expect(picture({})).toBe("thumb");
  });
});

describe("siteAccount", () => {
  it("knows a site's own account from a person", () => {
    expect(siteAccount("@youtube", "YouTube")).toBe(true);
    expect(siteAccount("@verge", "The Verge")).toBe(true);
    expect(siteAccount("@github", "GitHub")).toBe(true);
    expect(siteAccount("@janedoe", "The Verge")).toBe(false);
    expect(siteAccount("Ada Lovelace", "Ada")).toBe(false);
    expect(siteAccount("@x", undefined)).toBe(false);
    expect(siteAccount("@e", "The Verge")).toBe(false);
    expect(siteAccount("@x", "X")).toBe(true);
  });
});

describe("media file links", () => {
  const proxy = `/media/proxy/${Math.floor(Date.now() / 1000) + 86400}-signed/file`;
  it("uses the existing audio player with the signed proxy URL and readable filename", () => {
    const { container } = render(<Embeds list={[{ url: "https://files.example/music%20demo.mp3?download=1", type: "audio", media: proxy, media_kind: "audio" }]} />);
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(proxy);
    expect(container.textContent).toContain("music demo.mp3");
    expect(container.querySelector("audio")?.autoplay).toBe(false);
  });

  it("does not load a remote file if an embed contains an unproxied address", () => {
    const { container } = render(<Embeds list={[
      { url: "https://files.example/music.mp3", type: "audio", media: "https://files.example/music.mp3", media_kind: "audio" },
      { url: "https://files.example/movie.mp4", type: "video", image: "https://files.example/movie.mp4" },
    ]} />);
    expect(container.querySelector("audio, video")).toBeNull();
  });

  it("plays video files through the proxy too", () => {
    const { container } = render(<Embeds list={[{ url: "https://files.example/movie.mp4", type: "video", image: proxy }]} />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(proxy);
    expect(container.querySelector("video")?.autoplay).toBe(false);
  });
});
