// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUI } from "@/stores/ui";
import { installBackLayers } from "./backLayers";

const marked = () => (history.state as Record<string, unknown> | null)?.["nexaLayer"] === true;

describe("back closes what is open over the page", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    // a phone: a touch screen, narrow enough for the drawer
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("coarse") || q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    useUI.setState({ leftOpen: false, rightOpen: false });
    stop = installBackLayers();
    vi.advanceTimersByTime(100);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("puts one entry on top while the drawer is open, and back closes the drawer instead of leaving", () => {
    const before = history.length;
    useUI.getState().setLeftOpen(true);
    vi.advanceTimersByTime(100);
    expect(marked()).toBe(true);
    expect(history.length).toBe(before + 1);

    // back pops the extra entry: the page's own is current again
    History.prototype.replaceState.call(history, { idx: 0 }, "");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(useUI.getState().leftOpen).toBe(false);
  });

  it("lets a navigation from inside the drawer replace the extra entry rather than bury it", () => {
    useUI.getState().setLeftOpen(true);
    vi.advanceTimersByTime(100);
    const withLayer = history.length;
    // the router going to a conversation picked in the drawer
    history.pushState({ idx: 1 }, "", "/channels/@me/1");
    expect(history.length).toBe(withLayer);
    expect(marked()).toBe(false);
    // and once away from it, pushes are pushes again
    history.pushState({ idx: 2 }, "", "/channels/@me/2");
    expect(history.length).toBe(withLayer + 1);
  });
});
