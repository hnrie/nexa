import { ApiError } from "@/api/client";
import { users } from "@/api/users";
import { randomBytes } from "@/crypto/bytes";
import { decryptSettings, encryptSettings } from "@/lib/settingsCrypto";
import { useSettings } from "./settings";

const key = randomBytes(32);

/** A stand-in for the account's settings on the server, with its version check. */
function fakeServer(doc: Record<string, unknown>, version = 1) {
  const server = { doc, version, puts: 0, fail: null as Error | null };
  vi.spyOn(users, "getSettings").mockImplementation(async () => ({ blob: await encryptSettings(key, server.doc), version: server.version }));
  vi.spyOn(users, "putSettings").mockImplementation(async (blob, v) => {
    server.puts += 1;
    if (server.fail) throw server.fail;
    if (v !== server.version) throw new ApiError(409, "version_conflict", "Settings changed elsewhere.");
    server.doc = (await decryptSettings(key, blob)) as Record<string, unknown>;
    server.version += 1;
    return { version: server.version };
  });
  return server;
}

async function loadFrom(server: { doc: Record<string, unknown>; version: number }): Promise<void> {
  await useSettings.getState().load(await encryptSettings(key, server.doc), server.version);
}

beforeEach(() => {
  useSettings.getState().reset();
  useSettings.getState().setKey(key);
});

afterEach(() => {
  useSettings.getState().reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("settings sync", () => {
  it("does not save defaults over the account before its settings arrive", async () => {
    const server = fakeServer({ theme: "light", userNotes: { u1: "friend from work" } });
    useSettings.getState().setDraft("c1", "hello");
    await useSettings.getState().flush();
    expect(server.puts).toBe(0);
    await loadFrom(server);
    await useSettings.getState().flush();
    expect(server.doc).toMatchObject({ theme: "light", userNotes: { u1: "friend from work" }, drafts: { c1: "hello" } });
    expect(useSettings.getState().settings.theme).toBe("light");
  });

  it("keeps another device's change when both saved at once", async () => {
    const server = fakeServer({ theme: "dark", fontScale: 1 });
    await loadFrom(server);
    // the other device saves first
    server.doc = { ...server.doc, theme: "light", appLock: null, userNotes: { u2: "note" } };
    server.version += 1;
    useSettings.getState().patch({ fontScale: 1.2 });
    await useSettings.getState().flush();
    expect(server.doc).toMatchObject({ theme: "light", fontScale: 1.2, userNotes: { u2: "note" } });
    expect(useSettings.getState().settings).toMatchObject({ theme: "light", fontScale: 1.2 });
    expect(useSettings.getState().version).toBe(server.version);
  });

  it("keeps a change made during a save when that save's echo reloads", async () => {
    const server = fakeServer({ theme: "dark" });
    await loadFrom(server);
    useSettings.getState().patch({ showMembers: false });
    const first = useSettings.getState().flush();
    useSettings.getState().patch({ sidebarWidth: 300 });
    // the echo of the first save arrives before its reply
    const reload = useSettings.getState().reload();
    // flushing while a save is under way waits for the changes it missed
    const second = useSettings.getState().flush();
    await Promise.all([first, reload, second]);
    expect(useSettings.getState().settings).toMatchObject({ showMembers: false, sidebarWidth: 300 });
    expect(server.doc).toMatchObject({ showMembers: false, sidebarWidth: 300 });
  });

  it("keeps an unmute made here when another device's copy arrives", async () => {
    const n = { desktop: false, app: true, sounds: true, perChannel: { c5: "none", c7: "all" }, muted: ["c1", "c2"] };
    const server = fakeServer({ notifications: n });
    await loadFrom(server);
    // the other device mutes c3 and sets a level on c6, and saves first
    server.doc = { ...server.doc, notifications: { ...n, muted: ["c1", "c2", "c3"], perChannel: { ...n.perChannel, c6: "mentions", c7: "none" } } };
    server.version += 1;
    // this device unmutes c1 and clears c5's level
    const mine = useSettings.getState().settings.notifications;
    useSettings.getState().patch({ notifications: { ...mine, muted: ["c2"], perChannel: { c7: "all" } } });
    await useSettings.getState().flush();
    const saved = server.doc["notifications"] as typeof n;
    expect([...saved.muted].sort()).toEqual(["c2", "c3"]);
    // c5 cleared here, c6 set there, and c7, untouched here, keeps the other device's change
    expect(saved.perChannel).toEqual({ c6: "mentions", c7: "none" });
    expect(useSettings.getState().settings.notifications.muted.sort()).toEqual(["c2", "c3"]);
  });

  it("sends a change still waiting when the store is reset straight after", async () => {
    const server = fakeServer({ theme: "dark" });
    await loadFrom(server);
    useSettings.getState().patch({ theme: "ash" });
    // what stopping the session does when the app locks
    const sent = useSettings.getState().flush();
    useSettings.getState().reset();
    await sent;
    expect(server.doc["theme"]).toBe("ash");
  });

  it("tries a save that could not reach the server again later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = fakeServer({ theme: "dark" });
    await loadFrom(server);
    server.fail = new TypeError("Failed to fetch");
    useSettings.getState().patch({ theme: "onyx" });
    await useSettings.getState().flush();
    expect(server.doc["theme"]).toBe("dark");
    server.fail = null;
    await vi.advanceTimersByTimeAsync(2_000);
    await useSettings.getState().flush();
    expect(server.doc["theme"]).toBe("onyx");
  });
});

describe("screen share settings", () => {
  it("carries an older stream quality over to a size and frame rate", async () => {
    await loadFrom({ doc: { voice: { streamQuality: "1080p60" } }, version: 1 });
    const v = useSettings.getState().settings.voice;
    expect(v.shareResolution).toBe("1080p");
    expect(v.shareFps).toBe(60);
    expect("streamQuality" in v).toBe(false);
  });

  it("keeps a size and frame rate already chosen", async () => {
    await loadFrom({ doc: { voice: { streamQuality: "720p30", shareResolution: "1440p", shareFps: 15 } }, version: 1 });
    const v = useSettings.getState().settings.voice;
    expect(v.shareResolution).toBe("1440p");
    expect(v.shareFps).toBe(15);
  });
});

describe("device settings", () => {
  it("treats a saved Chromium alias as the system's own device", async () => {
    await loadFrom({ doc: { voice: { inputDeviceId: "communications", inputDeviceLabel: "Communications - Headset", outputDeviceId: "default", cameraDeviceId: "cam1", cameraDeviceLabel: "Webcam" } }, version: 1 });
    const v = useSettings.getState().settings.voice;
    expect([v.inputDeviceId, v.inputDeviceLabel, v.outputDeviceId]).toEqual([null, null, null]);
    expect([v.cameraDeviceId, v.cameraDeviceLabel]).toEqual(["cam1", "Webcam"]);
  });
});
