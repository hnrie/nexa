// @vitest-environment jsdom
import { showNotification } from "./notify";

function withWorker(reg: unknown) {
  Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: () => Promise.resolve(reg) }, configurable: true });
}

describe("showNotification", () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it("goes through the service worker, which phones require", async () => {
    const shown: unknown[] = [];
    withWorker({ active: {}, showNotification: (title: string, opts: unknown) => void shown.push([title, opts]) });
    (globalThis as { Notification?: unknown }).Notification = function () {
      throw new TypeError("Illegal constructor");
    };
    expect(await showNotification("Ann", { body: "hi" }, "/channels/@me/1")).toBe(true);
    expect(shown).toEqual([["Ann", { body: "hi", data: { path: "/channels/@me/1" } }]]);
  });

  it("falls back to the constructor without a running worker, and says when nothing works", async () => {
    withWorker(undefined);
    const made: string[] = [];
    (globalThis as { Notification?: unknown }).Notification = function (this: object, title: string) {
      made.push(title);
    };
    expect(await showNotification("Ann", { body: "hi" })).toBe(true);
    expect(made).toEqual(["Ann"]);

    (globalThis as { Notification?: unknown }).Notification = function () {
      throw new TypeError("Illegal constructor");
    };
    expect(await showNotification("Ann", { body: "hi" })).toBe(false);
  });
});
