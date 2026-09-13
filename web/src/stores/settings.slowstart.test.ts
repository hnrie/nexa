import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ doc: {} as Record<string, unknown>, version: 1, puts: [] as { doc: Record<string, unknown>; version: number }[] }));

vi.mock("@/lib/settingsCrypto", () => ({
  encryptSettings: async (_key: Uint8Array, doc: unknown) => JSON.stringify(doc),
  decryptSettings: async (_key: Uint8Array, blob: string) => JSON.parse(blob) as unknown,
}));

vi.mock("@/api/users", async () => {
  const { ApiError } = await import("@/api/client");
  return {
    users: {
      getSettings: async () => ({ blob: JSON.stringify(server.doc), version: server.version }),
      putSettings: async (blob: string, version: number) => {
        if (version !== server.version) throw new ApiError(409, "conflict", "Settings changed.");
        server.doc = JSON.parse(blob) as Record<string, unknown>;
        server.version++;
        server.puts.push({ doc: server.doc, version });
        return { version: server.version };
      },
    },
  };
});

import { useSettings } from "./settings";

describe("settings store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    server.doc = { theme: "light", drafts: { c9: "saved" }, appLock: null };
    server.version = 1;
    server.puts = [];
    useSettings.getState().reset();
    useSettings.getState().setKey(new Uint8Array(32));
  });
  afterEach(() => vi.useRealTimers());

  it("never saves the defaults over the account's settings before they have loaded", async () => {
    useSettings.getState().setDraft("c1", "ok");
    await vi.advanceTimersByTimeAsync(2000);
    await useSettings.getState().flush();
    expect(server.puts).toHaveLength(0);

    await useSettings.getState().load(JSON.stringify(server.doc), server.version);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.puts).toHaveLength(1);
    expect(server.doc.theme).toBe("light");
    expect((server.doc.drafts as Record<string, string>).c1).toBe("ok");
  });

  it("keeps another device's change when a save conflicts", async () => {
    await useSettings.getState().load(JSON.stringify(server.doc), server.version);
    // another device saves a new theme in the meantime
    server.doc = { ...server.doc, theme: "onyx" };
    server.version = 2;
    useSettings.getState().patch({ skinTone: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.doc.theme).toBe("onyx");
    expect(server.doc.skinTone).toBe(3);
    expect(useSettings.getState().settings.theme).toBe("onyx");
  });
});
