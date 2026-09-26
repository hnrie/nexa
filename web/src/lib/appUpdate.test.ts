// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktop } from "@/stores/desktop";
import { useUI } from "@/stores/ui";
import { HIDDEN_RELOAD_MS, SNOOZE_MS, applyUpdate, cancelUpdate, checkForUpdate, isSnoozed, page, resetAppUpdate, snoozeUpdate, startUpdateChecks, useAppUpdate } from "./appUpdate";
import { holdReload } from "./busy";
import type { EvilionDesktop, UpdateState } from "./desktopBridge";

/** A server that serves `build` from version.json, counting the asks. */
function server(build: unknown, init: { status?: number; body?: string } = {}) {
  const calls: RequestInit[] = [];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, opts?: RequestInit) => {
    calls.push(opts ?? {});
    return new Response(init.body ?? JSON.stringify({ build }), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

function visibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

let reloads = 0;
beforeEach(() => {
  vi.useFakeTimers();
  resetAppUpdate();
  reloads = 0;
  page.reload = () => void (reloads += 1);
  useUI.setState({ modals: [], modal: null, editing: null, replyTo: null, quickSwitcher: false, connection: "idle" });
  useDesktop.setState({ update: null });
  visibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { evilionDesktop?: unknown }).evilionDesktop;
});

describe("finding a new build", () => {
  it("knows the page is current when the server serves its own build", async () => {
    const s = server("abc123");
    expect(await checkForUpdate({ current: "abc123", fetcher: s.fetcher })).toBe(false);
    expect(useAppUpdate.getState().web).toBeNull();
    // asked past every cache
    expect(s.calls[0]?.cache).toBe("no-store");
  });

  it("finds a deploy, including one that went back to an older build", async () => {
    expect(await checkForUpdate({ current: "abc123", fetcher: server("abc124").fetcher })).toBe(true);
    expect(useAppUpdate.getState().web).toBe("abc124");
    expect(await checkForUpdate({ current: "abc123", fetcher: server("abc100").fetcher })).toBe(true);
    expect(useAppUpdate.getState().web).toBe("abc100");
  });

  it("learns nothing from an answer that is not a build", async () => {
    for (const s of [server(null), server(42), server("../x"), server("x".repeat(40)), server("", { status: 404 }), server("abc124", { body: "<!doctype html>" })]) {
      expect(await checkForUpdate({ current: "abc123", fetcher: s.fetcher })).toBe(false);
    }
    const offline = vi.fn(async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
    expect(await checkForUpdate({ current: "abc123", fetcher: offline })).toBe(false);
    expect(useAppUpdate.getState().web).toBeNull();
  });

  it("asks again when the gateway comes back, and on focus no more than once a minute", async () => {
    const s = server("new1");
    vi.stubGlobal("fetch", s.fetcher);
    const stop = startUpdateChecks({ build: "old1", enabled: true });
    try {
      useUI.getState().setConnection("connecting");
      useUI.getState().setConnection("open");
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls).toHaveLength(1);
      expect(useAppUpdate.getState().web).toBe("new1");
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(61_000);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls).toHaveLength(2);
      // and every ten minutes regardless
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(s.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      stop();
      vi.unstubAllGlobals();
    }
  });
});

describe("moving onto it", () => {
  it("reloads once nothing is held, and says what it waits for meanwhile", async () => {
    const call = holdReload("call");
    const upload = holdReload("upload");
    void applyUpdate("reload");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useAppUpdate.getState()).toMatchObject({ applying: "reload", waiting: "call" });
    call();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(useAppUpdate.getState().waiting).toBe("upload");
    expect(reloads).toBe(0);
    upload();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloads).toBe(1);
  });

  it("stays where it is when the wait is cancelled", async () => {
    const call = holdReload("call");
    void applyUpdate("reload");
    await vi.advanceTimersByTimeAsync(2_000);
    cancelUpdate();
    expect(useAppUpdate.getState().applying).toBeNull();
    call();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloads).toBe(0);
  });

  it("restarts the desktop app into its new version once it has downloaded", async () => {
    const restart = vi.fn(async () => undefined);
    (window as { evilionDesktop?: unknown }).evilionDesktop = { updates: { restart } } as unknown as EvilionDesktop;
    const state = (u: Partial<UpdateState>) => useDesktop.setState({ update: { status: "downloading", version: "1.2.0", ...u } as UpdateState });
    state({ progress: 0.4 });
    void applyUpdate("restart");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useAppUpdate.getState()).toMatchObject({ applying: "restart", waiting: "update" });
    expect(restart).not.toHaveBeenCalled();
    state({ status: "ready" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(restart).toHaveBeenCalledOnce();
    expect(reloads).toBe(0);
  });

  it("gives up on a restart whose download stopped", async () => {
    const restart = vi.fn(async () => undefined);
    (window as { evilionDesktop?: unknown }).evilionDesktop = { updates: { restart } } as unknown as EvilionDesktop;
    useDesktop.setState({ update: { status: "downloading", progress: 0.1 } });
    void applyUpdate("restart");
    await vi.advanceTimersByTimeAsync(1_000);
    useDesktop.setState({ update: { status: "error", error: "network" } });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(restart).not.toHaveBeenCalled();
    expect(useAppUpdate.getState().applying).toBeNull();
  });
});

describe("a page nobody is looking at", () => {
  async function awayWithUpdate(ms: number) {
    await checkForUpdate({ current: "old1", fetcher: server("new1").fetcher });
    const stop = startUpdateChecks({ build: "old1", enabled: true });
    visibility("hidden");
    await vi.advanceTimersByTimeAsync(ms);
    return stop;
  }

  it("reloads onto the new build by itself after ten minutes out of sight", async () => {
    const stop = await awayWithUpdate(HIDDEN_RELOAD_MS - 60_000);
    expect(reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(reloads).toBe(1);
    stop();
  });

  it("does not while something is open or going on", async () => {
    useUI.setState({ modals: [{ id: 1, kind: "settings" }] });
    const call = holdReload("call");
    let stop = await awayWithUpdate(HIDDEN_RELOAD_MS + 2 * 60_000);
    expect(reloads).toBe(0);
    useUI.setState({ modals: [] });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(reloads).toBe(0);
    call();
    stop();
    stop = startUpdateChecks({ build: "old1", enabled: true });
    visibility("hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_RELOAD_MS + 2 * 60_000);
    expect(reloads).toBe(1);
    stop();
  });

  it("gives up if its person comes back first", async () => {
    const stop = await awayWithUpdate(HIDDEN_RELOAD_MS - 1_000);
    // the reload has begun (it waits a moment for quiet), and the page comes back
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useAppUpdate.getState().applying).toBe("reload");
    visibility("visible");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloads).toBe(0);
    expect(useAppUpdate.getState().applying).toBeNull();
    stop();
  });
});

describe("Later", () => {
  it("holds for two hours, and a newer update asks at once", () => {
    const now = 1_000_000;
    snoozeUpdate("web:new1", now);
    const snoozed = useAppUpdate.getState().snoozed;
    expect(isSnoozed("web:new1", snoozed, now + SNOOZE_MS - 1)).toBe(true);
    expect(isSnoozed("web:new1", snoozed, now + SNOOZE_MS)).toBe(false);
    expect(isSnoozed("web:new2", snoozed, now + 1)).toBe(false);
  });
});
