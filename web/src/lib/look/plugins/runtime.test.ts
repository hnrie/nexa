// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/components/composer/commands";
import { dispatchHooks } from "@/gateway/dispatch";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useUI } from "@/stores/ui";
import { lookCache } from "../cache";
import { codeHash } from "../hash";
import { packText } from "../pack";
import type { PluginEntry } from "../types";
import { checkForUpdate, forgetPlugins, moduleLoader, retryPlugin, schemaOf, settingValues, syncPlugins, usePlugins } from "./runtime";

/*
 * Test plugins are written as object literals and turned into modules by the
 * loader below, since Node cannot import a blob: URL. `loaded` records every
 * piece of code that was ever turned into a module, which is how these tests
 * see that code the person did not approve is never run.
 */
const loaded: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(async () => {
  // a device that has kept no plugin's code yet
  await lookCache.clear();
  loaded.length = 0;
  moduleLoader.load = async (code: string) => {
    loaded.push(code);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return { default: new Function(`return (${code});`)() as unknown };
  };
  usePlugins.setState({ byId: {} });
  document.getElementById("nexa-custom-css")?.remove();
  localStorage.clear();
});

afterEach(async () => {
  await forgetPlugins();
  vi.unstubAllGlobals();
});

const HELLO = `{
  name: "Hello", version: "1.0.0", author: "Tests", description: "Says hello",
  settings: [{ key: "greeting", type: "text", label: "Greeting", default: "hi" }, { key: "loud", type: "toggle", label: "Loud" }],
  start(api) {
    globalThis.helloApi = api;
    api.css.add(".hello { color: red }");
    api.events.on("messageCreate", (m) => { globalThis.heard = m.content; });
    api.commands.register({ name: "hello", description: "Greets", run: (args) => api.settings.get("greeting") + " " + args });
    api.settings.onChange((v) => { globalThis.changed = v.greeting; });
  },
  stop() { globalThis.stopped = (globalThis.stopped || 0) + 1; },
}`;

async function pasted(code: string, patch: Partial<PluginEntry> = {}): Promise<PluginEntry> {
  return { id: "abcdefghij", source: "code", url: null, code: await packText(code), hash: codeHash(code), enabled: true, settings: {}, meta: null, addedAt: 1, ...patch };
}

const pluginSheets = () => [...document.querySelectorAll('#nexa-custom-css [data-group="plugins"] style')].map((s) => s.textContent);

describe("running a plugin", () => {
  it("starts it with the API and undoes what it registered when it stops", async () => {
    const entry = await pasted(HELLO);
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("running");
    expect(usePlugins.getState().byId[entry.id]?.meta).toEqual({ name: "Hello", description: "Says hello", version: "1.0.0", author: "Tests" });
    expect(pluginSheets()).toEqual([".hello { color: red }"]);

    // it hears messages, decrypted
    dispatchHooks.onMessage.forEach((h) => h({} as never, false, { id: "1", channel_id: "c", author_id: "u", payload: { t: "secret words" }, mentions: [], reply_to_id: null, created_at: 1, edited_at: null } as unknown as DecryptedMessage));
    expect(g["heard"]).toBe("secret words");

    // its command is there and answers
    const cmd = runCommand("/hello world");
    expect(cmd.kind).toBe("plugin");
    if (cmd.kind === "plugin") expect(await cmd.run("c")).toBe("hi world");

    // turned off: stop() ran, and its style, command and listener are gone with it
    await syncPlugins([{ ...entry, enabled: false }], true);
    expect(g["stopped"]).toBe(1);
    expect(pluginSheets()).toEqual([]);
    expect(runCommand("/hello world").kind).toBe("unknown");
    g["heard"] = undefined;
    dispatchHooks.onMessage.forEach((h) => h({} as never, false, { id: "2", channel_id: "c", author_id: "u", payload: { t: "later" }, mentions: [], reply_to_id: null, created_at: 1, edited_at: null } as unknown as DecryptedMessage));
    expect(g["heard"]).toBeUndefined();
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("off");
  });

  it("hands a running plugin its new setting values", async () => {
    const entry = await pasted(HELLO);
    await syncPlugins([entry], true);
    await syncPlugins([{ ...entry, settings: { greeting: "hey" } }], true);
    expect(g["changed"]).toBe("hey");
    const cmd = runCommand("/hello you");
    if (cmd.kind === "plugin") expect(await cmd.run("c")).toBe("hey you");
  });

  it("keeps storage per plugin, on this device", async () => {
    const entry = await pasted(HELLO);
    await syncPlugins([entry], true);
    const api = g["helloApi"] as { storage: { set: (k: string, v: unknown) => void; get: (k: string) => unknown; keys: () => string[] } };
    api.storage.set("count", 3);
    expect(api.storage.get("count")).toBe(3);
    expect(api.storage.keys()).toEqual(["count"]);
  });
});

describe("hash pinning", () => {
  it("never runs pasted code that does not match its hash", async () => {
    const entry = await pasted(HELLO, { hash: codeHash(HELLO + " ") });
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("mismatch");
    expect(loaded).toEqual([]);
  });

  it("runs code from a link only when it is the code that was approved, and asks about anything else", async () => {
    const v1 = HELLO;
    const v2 = HELLO.replace('"1.0.0"', '"2.0.0"');
    let served = v1;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(served, { status: 200, headers: { "content-type": "text/javascript" } }) as Response & { url: string }));
    const entry: PluginEntry = { id: "linkedplug", source: "url", url: "https://plugins.example/hello.js", code: null, hash: codeHash(v1), enabled: true, settings: {}, meta: null, addedAt: 1 };
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("running");
    expect(loaded).toEqual([v1]);

    // the link moves on: the running version stays, the new one waits for a yes
    served = v2;
    expect(await checkForUpdate(entry)).toBe("changed");
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("running");
    expect(usePlugins.getState().byId[entry.id]?.update?.hash).toBe(codeHash(v2));
    expect(loaded).toEqual([v1]);

    // approving it is pinning the new hash; only then does the new code run
    await syncPlugins([{ ...entry, hash: codeHash(v2) }], true);
    expect(loaded).toEqual([v1, v2]);
    expect(usePlugins.getState().byId[entry.id]?.meta?.version).toBe("2.0.0");
  });

  it("on a device that has not seen the approved code, does not run what the link serves now", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{ name: 'Other', start() {} }", { status: 200 })));
    const entry: PluginEntry = { id: "linkedplug", source: "url", url: "https://plugins.example/hello.js", code: null, hash: codeHash(HELLO), enabled: true, settings: {}, meta: null, addedAt: 1 };
    await syncPlugins([entry], true);
    const state = usePlugins.getState().byId[entry.id];
    expect(state?.status).toBe("changed");
    expect(state?.update?.code).toContain("Other");
    expect(loaded).toEqual([]);
    // and a second sync does not fetch it all over again
    await syncPlugins([entry], true);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("runs the approved code from this device's copy, with the link out of reach", async () => {
    await lookCache.put(`code:${codeHash(HELLO)}`, { text: HELLO, fetchedAt: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    const entry: PluginEntry = { id: "linkedplug", source: "url", url: "https://plugins.example/hello.js", code: null, hash: codeHash(HELLO), enabled: true, settings: {}, meta: null, addedAt: 1 };
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("running");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says why when the link cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const entry: PluginEntry = { id: "linkedplug", source: "url", url: "https://plugins.example/hello.js", code: null, hash: codeHash(HELLO), enabled: true, settings: {}, meta: null, addedAt: 1 };
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("unreachable");
  });
});

describe("a plugin that fails", () => {
  it("is turned off for the session, with a toast, and can be tried again", async () => {
    const toast = vi.spyOn(useUI.getState(), "toast");
    const bad = `{ name: "Bad", start(api) { api.css.add("x {}"); throw new Error("boom"); } }`;
    const entry = await pasted(bad);
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("failed");
    expect(usePlugins.getState().byId[entry.id]?.error).toBe("boom");
    expect(toast).toHaveBeenCalled();
    // what it added before throwing is gone
    expect(pluginSheets()).toEqual([]);
    // not started again on the next sync
    loaded.length = 0;
    await syncPlugins([entry], true);
    expect(loaded).toEqual([]);
    retryPlugin(entry.id);
    await syncPlugins([entry], true);
    expect(loaded).toEqual([bad]);
    toast.mockRestore();
  });

  it("that has no start function is not a plugin", async () => {
    const entry = await pasted(`{ name: "Nothing" }`);
    await syncPlugins([entry], true);
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("failed");
  });

  it("that took the page down while starting is skipped on the next start", async () => {
    const entry = await pasted(HELLO);
    localStorage.setItem("ec:look:starting", entry.id);
    // the flag is read on the first sync only, so this runs in a fresh copy of the module
    vi.resetModules();
    const fresh = await import("./runtime");
    fresh.moduleLoader.load = moduleLoader.load;
    await fresh.syncPlugins([entry], true);
    expect(fresh.usePlugins.getState().byId[entry.id]?.status).toBe("failed");
    expect(loaded).toEqual([]);
    await fresh.syncPlugins([], true);
  });
});

describe("safe mode", () => {
  it("keeps plugins off and says why", async () => {
    const entry = await pasted(HELLO);
    await syncPlugins([entry], false, "safe");
    expect(usePlugins.getState().byId[entry.id]?.status).toBe("safe");
    expect(loaded).toEqual([]);
  });
});

describe("plugin settings", () => {
  it("keeps only settings the page can draw, with defaults of the right type", () => {
    const schema = schemaOf({
      settings: [
        { key: "on", type: "toggle", label: "On" },
        { key: "n", type: "number", label: "N", min: 1, max: 5, default: 3 },
        { key: "pick", type: "select", label: "Pick", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" },
        { key: "bad key!", type: "toggle", label: "Bad" },
        { key: "nolabel", type: "toggle" },
        { key: "weird", type: "slider", label: "Weird" },
        { key: "c", type: "color", label: "Colour", default: "not a colour" },
      ] as never,
    });
    expect(schema.map((s) => s.key)).toEqual(["on", "n", "pick", "c"]);
    expect(settingValues(schema, { n: 99, pick: "zzz", on: "yes" })).toEqual({ on: false, n: 5, pick: "b", c: "#8000ff" });
  });
});
