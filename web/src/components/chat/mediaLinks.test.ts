import type { UnfurlResult } from "@/api/types";
import { isOnlyMediaLinks } from "./mediaLinks";

// what the GIF picker sends: a path on this server's image proxy
const gif: UnfurlResult = { url: "/media/proxy/ma2r4F/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29t", type: "gif", image: "/media/proxy/ma2r4F/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29t" };
const image: UnfurlResult = { url: "https://cdn.example/cat.png", type: "image" };
const video: UnfurlResult = { url: "https://cdn.example/clip.mp4", type: "video" };
const page: UnfurlResult = { url: "https://news.example/story", type: "link", title: "A story" };

describe("isOnlyMediaLinks", () => {
  it("hides a link that is only there to carry its picture or GIF", () => {
    expect(isOnlyMediaLinks(gif.url, [gif])).toBe(true);
    expect(isOnlyMediaLinks("  https://cdn.example/cat.png\n", [image])).toBe(true);
    expect(isOnlyMediaLinks("https://cdn.example/cat.png https://cdn.example/other.png", [image, { ...image, url: "https://cdn.example/other.png" }])).toBe(true);
    // a redirect leaves the preview with a different address than the one typed
    expect(isOnlyMediaLinks("http://short.example/x", [image])).toBe(true);
  });

  it("keeps the original links of audio and video files visible", () => {
    const audio: UnfurlResult = { url: "https://cdn.example/track.mp3?token=original", type: "audio", media: "/media/proxy/signed/file", media_kind: "audio" };
    expect(isOnlyMediaLinks(video.url, [video])).toBe(false);
    expect(isOnlyMediaLinks(audio.url, [audio])).toBe(false);
    expect(isOnlyMediaLinks("https://short.example/movie", [video])).toBe(false);
    expect(isOnlyMediaLinks(`${audio.url} ${video.url}`, [audio, video])).toBe(false);
  });

  it("does not take any path for a media link", () => {
    expect(isOnlyMediaLinks("/media/proxy/something-else", [gif])).toBe(false);
    expect(isOnlyMediaLinks(`${gif.url} /shrug`, [gif])).toBe(false);
  });

  it("keeps text that says anything more", () => {
    expect(isOnlyMediaLinks(`look at this ${image.url}`, [image])).toBe(false);
    expect(isOnlyMediaLinks("no links here", [])).toBe(false);
    expect(isOnlyMediaLinks("", [image])).toBe(false);
  });

  it("keeps links whose previews are not pictures, or that did not all get one", () => {
    expect(isOnlyMediaLinks(page.url, [page])).toBe(false);
    expect(isOnlyMediaLinks(`${image.url} ${page.url}`, [image, page])).toBe(false);
    expect(isOnlyMediaLinks(`${image.url} https://other.example/y.png`, [image])).toBe(false);
    expect(isOnlyMediaLinks(image.url, [])).toBe(false);
  });
});
