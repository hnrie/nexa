import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A page with just what videoShown reads: whether it is seen, what floats, and its events. */
function fakeDocument() {
  const handlers = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: "visible" as "visible" | "hidden",
    pictureInPictureElement: null as object | null,
    querySelectorAll: () => [] as unknown[],
    addEventListener: (e: string, h: () => void) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h),
    removeEventListener: (e: string, h: () => void) => void handlers.get(e)?.delete(h),
    fire: (e: string) => handlers.get(e)?.forEach((h) => h()),
    listening: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  };
  vi.stubGlobal("document", doc);
  return doc;
}

async function load() {
  vi.resetModules();
  return import("./videoShown");
}

let doc: ReturnType<typeof fakeDocument>;
beforeEach(() => {
  doc = fakeDocument();
});
afterEach(() => vi.unstubAllGlobals());

describe("whether a call's pictures are on screen", () => {
  it("follows the call views of that call that are open", async () => {
    const { callViewOpen, watchVideoShown } = await load();
    const seen: boolean[] = [];
    const stop = watchVideoShown(() => "call", (on) => seen.push(on));
    const other = callViewOpen("another channel");
    const first = callViewOpen("call");
    const second = callViewOpen("call");
    first();
    first(); // closing twice counts once
    second();
    other();
    expect(seen).toEqual([false, true, false]);
    stop();
    expect(doc.listening()).toBe(0);
  });

  it("is off while the page is hidden, unless a video floats", async () => {
    const { callViewOpen, watchVideoShown } = await load();
    const seen: boolean[] = [];
    watchVideoShown(() => "call", (on) => seen.push(on));
    callViewOpen("call");
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    doc.pictureInPictureElement = {};
    doc.fire("enterpictureinpicture");
    doc.pictureInPictureElement = null;
    doc.fire("leavepictureinpicture");
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(seen).toEqual([false, true, false, true, false, true]);
  });

  it("asks about the channel the call is in now", async () => {
    const { callViewOpen, recheckVideoShown, watchVideoShown } = await load();
    let channel = "old";
    const seen: boolean[] = [];
    watchVideoShown(() => channel, (on) => seen.push(on));
    callViewOpen("new");
    channel = "new";
    recheckVideoShown();
    expect(seen).toEqual([false, true]);
  });

  it("is off while the desktop app's window is minimised or in the tray, which keeps a call's page visible", async () => {
    const { callViewOpen, watchVideoShown } = await load();
    const { useDesktop } = await import("@/stores/desktop");
    const seen: boolean[] = [];
    useDesktop.getState().setWindow({ focused: true, visible: true, minimized: false });
    const stop = watchVideoShown(() => "call", (on) => seen.push(on));
    callViewOpen("call");
    useDesktop.getState().setWindow({ focused: false, visible: true, minimized: true });
    useDesktop.getState().setWindow({ focused: false, visible: true, minimized: false });
    useDesktop.getState().setWindow({ focused: false, visible: false, minimized: false });
    useDesktop.getState().setWindow({ focused: true, visible: true, minimized: false });
    stop();
    useDesktop.getState().setWindow({ focused: false, visible: false, minimized: false });
    expect(seen).toEqual([false, true, false, true, false, true]);
  });
});
