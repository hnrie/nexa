// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api as client } from "@/api/client";
import type { Channel, PublicUser, Relationship } from "@/api/types";
import { messageMenu } from "@/components/chat/messageMenu";
import { dispatchHooks } from "@/gateway/dispatch";
import { resetChanges } from "@/lib/contextMenus/registry";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { lookCache } from "../cache";
import { codeHash } from "../hash";
import { packText } from "../pack";
import type { PluginEntry } from "../types";
import { PermissionError } from "./api2";
import { toUser } from "./objects";
import { forgetPlugins, moduleLoader, syncPlugins, usePlugins } from "./runtime";

/* Test plugins are object literals turned into modules here, since Node cannot import a blob: URL. */
const g = globalThis as unknown as Record<string, unknown>;
type Api = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const apiOf = (name: string) => g[name] as Api;

beforeEach(async () => {
  await lookCache.clear();
  moduleLoader.load = async (code: string) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return { default: new Function(`return (${code});`)() as unknown };
  };
  usePlugins.setState({ byId: {} });
  resetChanges();
  document.getElementById("nexa-custom-css")?.remove();
  useAuth.setState({ me: { id: "me", username: "me", display_name: "Me", flags: 0 } as never });
  useUsers.setState({ byId: { bob: { id: "bob", username: "bob", display_name: "Bob", flags: 0, created_at: 5 } as unknown as PublicUser } });
  useChannels.setState({ byId: { sc: { id: "sc", server_id: "s1", type: "text", name: "general" } as Channel, dm: { id: "dm", server_id: null, type: "dm", name: "", recipient_ids: ["me", "bob"] } as unknown as Channel } });
  useRelationships.setState({ byUser: {} });
});

afterEach(async () => {
  await forgetPlugins();
  vi.restoreAllMocks();
});

async function entry(code: string, permissions: string[] | null, id = "abcdefghij", settings: Record<string, unknown> = {}): Promise<PluginEntry> {
  return { id, source: "code", url: null, code: await packText(code), hash: codeHash(code), enabled: true, settings, meta: null, addedAt: 1, ...(permissions ? { permissions } : {}) };
}

const v2 = (name: string, body = "", extra = "") => `{
  name: ${JSON.stringify(name)}, apiVersion: 2, ${extra}
  start(api) { globalThis[${JSON.stringify(name)}] = api; ${body} },
}`;

const message = (channel: string, text: string | null): DecryptedMessage =>
  ({ id: "1", channel_id: channel, author_id: "bob", type: "default", ...(text === null ? {} : { payload: { t: text } }), mentions: [], mention_roles: [], mention_everyone: false, reactions: [], flags: 0, reply_to_id: null, created_at: 1000, edited_at: null }) as unknown as DecryptedMessage;

describe("which API a plugin gets", () => {
  it("hands version 2 to a plugin that asks for it, and version 1 to the rest", async () => {
    await syncPlugins([await entry(v2("Two"), []), await entry(`{ name: "One", start(api) { globalThis.One = api; } }`, null, "bcdefghijk")], true);
    expect(apiOf("Two")["apiVersion"]).toBe(2);
    expect(apiOf("Two")["users"]).toBeDefined();
    expect(apiOf("One")["apiVersion"]).toBe(1);
    expect(apiOf("One")["css"]).toBeDefined();
  });

  it("will not start a plugin written for a version there is not", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = await entry(`{ name: "Three", apiVersion: 3, start() {} }`, []);
    await syncPlugins([e], true);
    expect(usePlugins.getState().byId[e.id]).toMatchObject({ status: "failed", error: expect.stringContaining("3") });
  });
});

describe("permissions", () => {
  it("throws a PermissionError without the permission, and works with it", async () => {
    const e = await entry(v2("Perm"), ["users.read"]);
    await syncPlugins([e], true);
    const a = apiOf("Perm");
    expect(a["users"].get("bob")).toMatchObject({ id: "bob", displayName: "Bob", relationship: null });
    expect(() => a["users"].me).toThrow(PermissionError);
    expect(() => a["servers"].list()).toThrow(/servers.read/);
    try {
      a["storage"].get("x");
    } catch (err) {
      expect((err as Error).name).toBe("PermissionError");
    }
  });

  it("takes a permission away at once, from calls and from events", async () => {
    const e = await entry(v2("Taken", `api.events.on("messageCreated", (m) => { globalThis.heardTaken = m.content; });`), ["users.read", "events.read", "servers.messages.read"]);
    await syncPlugins([e], true);
    const hear = (m: DecryptedMessage) => dispatchHooks.onMessage.forEach((h) => h({} as never, false, m));
    hear(message("sc", "first"));
    expect(g["heardTaken"]).toBe("first");
    await syncPlugins([{ ...e, permissions: ["events.read"] }], true);
    hear(message("sc", "second"));
    expect(g["heardTaken"]).toBe("first");
    expect(() => apiOf("Taken")["users"].get("bob")).toThrow(PermissionError);
  });
});

describe("events", () => {
  it("delivers server and DM messages by their own permissions, decrypted, or with no content", async () => {
    const got: unknown[] = [];
    g["gotEvents"] = got;
    await syncPlugins([await entry(v2("Ev", `api.events.on("messageCreated", (m) => globalThis.gotEvents.push([m.channelId, m.content, m.createdAt instanceof Date]));`), ["events.read", "servers.messages.read"])], true);
    for (const m of [message("sc", "server words"), message("dm", "dm words"), message("sc", null)]) dispatchHooks.onMessage.forEach((h) => h({} as never, false, m));
    expect(got).toEqual([["sc", "server words", true], ["sc", null, true]]);
  });

  it("turns the app's events into the API's, a relationship's kind by its API name", async () => {
    const got: unknown[] = [];
    g["gotRel"] = got;
    await syncPlugins([await entry(v2("Rel", `api.events.on("relationshipChanged", (e) => globalThis.gotRel.push([e.user && e.user.id, e.relationship, e.old]));`), ["events.read", "users.relationships.read", "users.read"])], true);
    useRelationships.getState().set({ user: useUsers.getState().byId["bob"]!, type: "incoming", nickname: "", created_at: 1 } as Relationship);
    expect(got).toEqual([["bob", "incomingRequest", "none"]]);
  });

  it("fires a custom event under the plugin's name, for other plugins to hear", async () => {
    await syncPlugins(
      [
        await entry(v2("Sender"), ["events.write"]),
        await entry(v2("Hearer", `api.events.on("Sender:ping", (d) => { globalThis.pinged = d; });`), ["events.read"], "bcdefghijk"),
      ],
      true,
    );
    apiOf("Sender")["events"].run("ping", { n: 1 });
    expect(g["pinged"]).toEqual({ n: 1 });
  });

  it("calls a once listener once, and a listener that throws stops nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    g["onceCount"] = 0;
    await syncPlugins([await entry(v2("Once", `api.events.once("localeChanged", () => { globalThis.onceCount++; }); api.events.on("localeChanged", () => { throw new Error("no"); });`), ["events.read"])], true);
    dispatchHooks.onEvent.forEach((h) => h({ type: "localeChanged", locale: "de" }));
    dispatchHooks.onEvent.forEach((h) => h({ type: "localeChanged", locale: "fr" }));
    expect(g["onceCount"]).toBe(1);
  });
});

describe("styles", () => {
  const sheets = () => [...document.querySelectorAll('#nexa-custom-css [data-group="plugins"] style')].map((s) => s.textContent);

  it("removes a stylesheet when the plugin stops, unless it asked to keep it, which goes when the plugin is deleted", async () => {
    const e = await entry(v2("Css", `api.styles.add(".a{}"); api.styles.add(".b{}", true);`), ["styles.write"]);
    await syncPlugins([e], true);
    expect(sheets()).toEqual([".a{}", ".b{}"]);
    await syncPlugins([{ ...e, enabled: false }], true);
    expect(sheets()).toEqual([".b{}"]);
    await syncPlugins([], true);
    expect(sheets()).toEqual([]);
  });
});

describe("settings", () => {
  const SET = `settings: [{ key: "size", type: "number", label: "Size", min: 1, max: 5, default: 3 }, { key: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" }],`;

  it("gives defaults, saves a value with the account, tells onChange, and refuses what does not fit", async () => {
    const e = await entry(v2("Prefs", `api.settings.onChange("size", (v, old) => { globalThis.sizeChange = [v, old]; });`, SET), []);
    useSettings.setState((s) => ({ settings: { ...s.settings, plugins: [e] } }));
    await syncPlugins([e], true);
    const st = apiOf("Prefs")["settings"];
    expect(st.get("size")).toBe(3);
    expect(st.get("nope")).toBeUndefined();
    st.set("size", 5);
    expect(st.get("size")).toBe(5);
    expect(g["sizeChange"]).toEqual([5, 3]);
    expect(useSettings.getState().settings.plugins[0]!.settings).toEqual({ size: 5 });
    expect(() => st.set("size", 9)).toThrow(/from 1 to 5/);
    expect(() => st.set("mode", "c")).toThrow(/one of a, b/);
    st.reset();
    expect(st.getAll()).toEqual({ size: 3, mode: "a" });
  });
});

describe("context menus", () => {
  const ids = () => messageMenu.items({ msg: { ...message("sc", "hi"), author_id: "me" } as DecryptedMessage, openReactionPicker: () => undefined }).map((i) => i.id);

  it("adds, edits and removes buttons on any menu, and takes it all back when the plugin stops", async () => {
    const e = await entry(
      v2(
        "Menu",
        `api.ui.contextMenu.add("message", { id: "quote", label: "Quote", after: "replyToMessage", onClick: (ctx) => { globalThis.quoted = ctx.message && ctx.message.content; } });
         api.ui.contextMenu.remove("deleteMessage");`,
      ),
      ["ui.write", "servers.messages.read"],
    );
    await syncPlugins([e], true);
    expect(ids()).toContain("plugin:quote");
    expect(ids()).not.toContain("delete");
    expect(ids().indexOf("plugin:quote")).toBe(ids().indexOf("reply") + 1);
    messageMenu.items({ msg: message("sc", "quote me"), openReactionPicker: () => undefined }).find((i) => i.id === "plugin:quote")!.onSelect!();
    expect(g["quoted"]).toBe("quote me");
    expect(apiOf("Menu")["ui"].contextMenu.get("deleteMessage")).toBeNull();
    await syncPlugins([{ ...e, enabled: false }], true);
    expect(ids()).not.toContain("plugin:quote");
    expect(ids()).toContain("delete");
  });
});

describe("the API's objects", () => {
  it("leaves out a user's relationship without the permission, and names it with it", () => {
    useRelationships.getState().set({ user: useUsers.getState().byId["bob"]!, type: "outgoing", nickname: "", created_at: 1 } as Relationship);
    const bob = useUsers.getState().byId["bob"]!;
    expect(toUser(bob, () => false).relationship).toBeNull();
    expect(toUser(bob, () => true).relationship).toBe("outgoingRequest");
    expect(Object.isFrozen(toUser(bob, () => true))).toBe(true);
  });
});

describe("managers", () => {
  it("fetches a message and decrypts it on this device, with no content when it cannot be read", async () => {
    vi.spyOn(client, "request").mockResolvedValue({ id: "9", channel_id: "sc", author_id: "bob", type: "default", ciphertext: null, mentions: [], mention_roles: [], mention_everyone: false, reactions: [], attachments: [], flags: 0, created_at: 1, edited_at: null, key_conv_id: null, key_epoch: null, reply_to_id: null } as never);
    await syncPlugins([await entry(v2("Msg"), ["servers.messages.read"])], true);
    expect(await apiOf("Msg")["messages"].fetch("sc", "9")).toMatchObject({ id: "9", content: null });
  });

  it("asks the server to update a member with only what changed, timeouts as times", async () => {
    const req = vi.spyOn(client, "request").mockResolvedValue({ server_id: "s1", user_id: "bob", nickname: "B", role_ids: [], joined_at: 0, timeout_until: null, flags: 0, avatar_id: null } as never);
    await syncPlugins([await entry(v2("Mem"), ["servers.members.write"])], true);
    const until = new Date(5000);
    await apiOf("Mem")["servers"].members.update("s1", 7n, { nickname: "B", timeoutUntil: until });
    expect(req).toHaveBeenCalledWith("PATCH", "/servers/s1/members/7", { nick: "B", timeout_until: 5000 });
  });

  it("asks before something with the app's own dialog, and hears no as false", async () => {
    await syncPlugins([await entry(v2("Ask"), ["ui.write"])], true);
    const answer = apiOf("Ask")["ui"].confirm({ title: "Sure?", message: "Really", confirmText: "Yes", cancelText: "No" });
    const modal = useUI.getState().modals.at(-1)!;
    expect(modal).toMatchObject({ kind: "confirm", props: { title: "Ask: Sure?", body: "Really", confirmLabel: "Yes", cancelLabel: "No" } });
    (modal.props!["onDismiss"] as () => void)();
    expect(await answer).toBe(false);
  });
});
