/**
 * What the page may put in an iframe.
 *
 * A guard stricter than the policy the page is already served under does not
 * add safety, it removes a feature. Blocking every off-origin subframe left
 * the captcha's iframe unable to load, so signing in sat on "checking" with no
 * callback to fail — and every embedded video went blank with it.
 */
import { describe, expect, it, vi } from "vitest";

// config.ts asks Electron whether this build is packaged, to decide whether
// EVILION_URL may point it somewhere else. Packaged is the shipping answer.
vi.mock("electron", () => ({ app: { isPackaged: true } }));

const { isFrameableUrl } = await import("../src/main/config");

describe("what may be framed", () => {
  it("allows exactly what the server's frame-src allows", () => {
    // internal/api/static.go: frame-src 'self' hcaptcha.com *.hcaptcha.com youtube-nocookie
    expect(isFrameableUrl("https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge")).toBe(true);
    expect(isFrameableUrl("https://hcaptcha.com/checksiteconfig")).toBe(true);
    expect(isFrameableUrl("https://www.youtube-nocookie.com/embed/abc123")).toBe(true);
  });

  it("allows a frame the page made itself, which has no origin yet", () => {
    expect(isFrameableUrl("about:blank")).toBe(true);
    expect(isFrameableUrl("")).toBe(true);
    expect(isFrameableUrl(null)).toBe(true);
  });

  it("refuses anywhere else", () => {
    expect(isFrameableUrl("https://evil.example/")).toBe(false);
    expect(isFrameableUrl("https://youtube.com/embed/abc")).toBe(false);
    // a lookalike host must not pass on a prefix
    expect(isFrameableUrl("https://newassets.hcaptcha.com.evil.example/")).toBe(false);
    expect(isFrameableUrl("https://evilhcaptcha.com/")).toBe(false);
    expect(isFrameableUrl("http://newassets.hcaptcha.com/")).toBe(false);
  });
});
