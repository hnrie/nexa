// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveLock, type LockConfig } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";
import { AppLockEffect } from "./AppLockEffect";

const USER = "42";

const CONFIG = (over: Partial<LockConfig> = {}): LockConfig => ({
  v: 1,
  salt: "AAAA",
  params: { m: 1024, t: 1, p: 1, v: 1 },
  wrapped: "AAAA",
  pub: "AAAA",
  autoLockMs: 0,
  lockOnBlur: true,
  blurDelayMs: 0,
  failures: 0,
  ...over,
});

/** The bits of the auth store the effect looks at. */
function ready() {
  useAuth.setState({ status: "ready", me: { id: USER } as never, lockVersion: 0 });
}

function visibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  saveLock(USER, CONFIG());
  ready();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  visibility("visible");
  useAuth.setState({ status: "loading", me: null });
});

describe("AppLockEffect", () => {
  it("locks when the tab goes to the background", () => {
    render(<AppLockEffect />);
    expect(useAuth.getState().status).toBe("ready");
    act(() => visibility("hidden"));
    act(() => void vi.advanceTimersByTime(50));
    expect(useAuth.getState().status).toBe("pinlocked");
  });

  it("locks when the window loses focus to another app", () => {
    render(<AppLockEffect />);
    act(() => void window.dispatchEvent(new Event("blur")));
    // the blur is given a moment to turn out to be the page's own
    expect(useAuth.getState().status).toBe("ready");
    act(() => void vi.advanceTimersByTime(1000));
    expect(useAuth.getState().status).toBe("pinlocked");
  });

  it("stays open when focus moves into an embed on the page", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => frame });
    document.hasFocus = () => true;
    render(<AppLockEffect />);
    act(() => void window.dispatchEvent(new Event("blur")));
    act(() => void vi.advanceTimersByTime(5000));
    expect(useAuth.getState().status).toBe("ready");
    Reflect.deleteProperty(document, "activeElement");
  });

  it("does not lock when focus comes back inside the delay", () => {
    localStorage.clear();
    saveLock(USER, CONFIG({ blurDelayMs: 30_000 }));
    useAuth.setState({ lockVersion: 1 });
    render(<AppLockEffect />);
    act(() => visibility("hidden"));
    act(() => void vi.advanceTimersByTime(5_000));
    act(() => visibility("visible"));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(useAuth.getState().status).toBe("ready");
  });

  it("locks again on the next blur after coming back", () => {
    render(<AppLockEffect />);
    act(() => visibility("hidden"));
    act(() => void vi.advanceTimersByTime(50));
    expect(useAuth.getState().status).toBe("pinlocked");
    // back in, unlocked, and away again
    act(() => visibility("visible"));
    act(() => ready());
    act(() => visibility("hidden"));
    act(() => void vi.advanceTimersByTime(50));
    expect(useAuth.getState().status).toBe("pinlocked");
  });

  it("follows the desktop app's window instead of the page's idea of focus", () => {
    let send: ((w: { focused: boolean; visible: boolean; minimized: boolean }) => void) | null = null;
    document.hasFocus = () => true; // what a page inside Electron wrongly reports
    (window as unknown as Record<string, unknown>).evilionDesktop = {
      version: "1.0.0",
      platform: "darwin",
      onWindowState: (cb: (w: { focused: boolean; visible: boolean; minimized: boolean }) => void) => {
        send = cb;
        return () => {};
      },
    };
    render(<AppLockEffect />);
    act(() => send?.({ focused: false, visible: true, minimized: false }));
    act(() => void vi.advanceTimersByTime(50));
    expect(useAuth.getState().status).toBe("pinlocked");
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "evilionDesktop");
  });
});
