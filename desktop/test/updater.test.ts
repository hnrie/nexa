import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let published = "1.0.1";
const fake = Object.assign(new EventEmitter(), {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  logger: {} as unknown,
  setFeedURL: vi.fn(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(),
});

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "1.0.0" },
  net: { fetch: vi.fn(async () => new Response(`version: ${published}\n`)) },
}));
vi.mock("electron-updater", () => ({ autoUpdater: fake }));

const { Updater } = await import("../src/main/update");

/** Lets the updater's awaits (its import of electron-updater, the fetches) run until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !done(); i++) await new Promise<void>((r) => setImmediate(r));
}
const downloading = (u: InstanceType<typeof Updater>) => () => u.state.status === "downloading";

/** A check that finds `version` and downloads it, finishing when `finish` is called. */
function offers(version: string) {
  let finish!: () => void;
  const downloadPromise = new Promise<void>((r) => (finish = r));
  const cancel = vi.fn();
  fake.checkForUpdates.mockResolvedValueOnce({ updateInfo: { version }, downloadPromise, cancellationToken: { cancel } });
  return {
    cancel,
    /** The download promise settling without an update, as a cancelled one does. */
    end: () => finish(),
    finish: () => {
      fake.emit("update-downloaded", { version });
      finish();
    },
  };
}

describe("Updater on Windows", () => {
  const platform = process.platform;
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearInterval", "Date"] });
    fake.checkForUpdates.mockReset();
    fake.quitAndInstall.mockReset();
    fake.removeAllListeners();
    published = "1.0.1";
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.useRealTimers();
  });

  it("never installs on quit, and installs once however often Update is pressed", async () => {
    const quit = vi.fn((install: () => void) => install());
    const u = new Updater("https://nexa.test/desktop/", "https://nexa.test/download", quit, () => undefined);
    const run = offers("1.0.1");
    const checking = u.check();
    await until(downloading(u));
    run.finish();
    await checking;
    expect(fake.autoInstallOnAppQuit).toBe(false);
    expect(u.state).toMatchObject({ status: "ready", version: "1.0.1" });
    u.restart();
    u.restart();
    await u.check();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("replaces a downloaded update when a newer one is published, and leaves it alone otherwise", async () => {
    const u = new Updater("https://nexa.test/desktop/", "https://nexa.test/download", () => undefined, () => undefined);
    const first = offers("1.0.1");
    const c1 = u.check();
    await until(downloading(u));
    first.finish();
    await c1;
    await u.check();
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(u.state.status).toBe("ready");

    published = "1.0.2";
    const second = offers("1.0.2");
    const c2 = u.check();
    await until(downloading(u));
    expect(u.state).toMatchObject({ status: "downloading", version: "1.0.2" });
    second.finish();
    await c2;
    expect(u.state).toMatchObject({ status: "ready", version: "1.0.2" });
  });

  it("gives up a stalled download and looks again later", async () => {
    const u = new Updater("https://nexa.test/desktop/", "https://nexa.test/download", () => undefined, () => undefined);
    u.start();
    const stalled = offers("1.0.1");
    await vi.advanceTimersByTimeAsync(10_000);
    await until(downloading(u));
    expect(u.state.status).toBe("downloading");
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(stalled.cancel).toHaveBeenCalled();
    expect(u.state.status).toBe("error");
    // the stalled run ending late changes nothing
    stalled.end();
    await until(() => false);
    expect(u.state.status).toBe("error");
    const retry = offers("1.0.1");
    await vi.advanceTimersByTimeAsync(2.5 * 60_000);
    await until(downloading(u));
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
    retry.finish();
    await until(() => u.state.status === "ready");
    expect(u.state).toMatchObject({ status: "ready", version: "1.0.1" });
    u.stop();
  });
});
