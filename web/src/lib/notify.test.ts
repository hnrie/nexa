// @vitest-environment jsdom
import { dispatchHooks } from "@/gateway/dispatch";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { DEFAULT_SETTINGS, useSettings, type NotificationPreview } from "@/stores/settings";
import { useUsers } from "@/stores/users";
import { useRelationships } from "@/stores/relationships";
import { installNotifications, messageAlert, showNotification } from "./notify";

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

describe("what a notification shows", () => {
  const shown: [string, NotificationOptions][] = [];
  beforeAll(() => installNotifications());
  beforeEach(() => {
    shown.length = 0;
    withWorker({ active: {}, showNotification: (title: string, opts: NotificationOptions) => void shown.push([title, opts]) });
    (globalThis as { Notification?: unknown }).Notification = Object.assign(function () {}, { permission: "granted" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    useAuth.setState({ me: { id: "me", username: "me", display_name: "Me", flags: 0 } as never });
    useUsers.getState().upsert([{ id: "u2", username: "ann", display_name: "Ann", avatar_id: null } as never]);
    useChannels.getState().upsert([{ id: "d1", type: "dm", server_id: null, name: "", recipient_ids: ["me", "u2"] } as never]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  const arrive = async (preview: NotificationPreview) => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, desktop: true, sounds: false, preview } } });
    const m = { id: "9", channel_id: "d1", author_id: "u2", type: "default", mentions: [], mention_roles: [], mention_everyone: false } as never;
    for (const h of dispatchHooks.onMessage) h(m, false, { ...(m as object), payload: { t: "the plan is at noon" } } as never);
    await new Promise((r) => setTimeout(r, 0));
    return shown.at(-1);
  };

  it("shows the sender and the text by default", async () => {
    expect(await arrive("full")).toEqual(["Ann", expect.objectContaining({ body: "the plan is at noon" })]);
  });

  it("shows only who wrote, when that is all it may show", async () => {
    const [title, opts] = (await arrive("name"))!;
    expect(title).toBe("Ann");
    expect(opts.body).toBe("New message");
  });

  it("stays silent for someone this account blocked", async () => {
    useRelationships.getState().set({ user: { id: "u2", username: "ann", display_name: "Ann", avatar_id: null } as never, type: "blocked", nickname: "", created_at: 0 });
    try {
      expect(await arrive("full")).toBeUndefined();
    } finally {
      useRelationships.getState().clear();
    }
  });

  it("shows neither the sender nor the text, nor their picture, when nothing may be shown", async () => {
    const [title, opts] = (await arrive("none"))!;
    expect(title).toBe("Nexa");
    expect(opts.body).toBe("New message");
    expect(opts.icon).toBe("/icons/icon-192.png");
  });
});

describe("messageAlert", () => {
  it("stays quiet in the conversation being looked at", () => {
    expect(messageAlert(true, true)).toEqual({ sound: false, popup: false });
  });

  it("only sounds for another conversation while the app is in front", () => {
    expect(messageAlert(true, false)).toEqual({ sound: true, popup: false });
  });

  it("notifies whenever the app is not in front, even for the open conversation", () => {
    expect(messageAlert(false, true)).toEqual({ sound: true, popup: true });
    expect(messageAlert(false, false)).toEqual({ sound: true, popup: true });
  });
});
