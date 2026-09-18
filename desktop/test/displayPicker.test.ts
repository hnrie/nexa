/**
 * What the screen-share picker promises, held to it.
 *
 * The picker exists because the page used to answer its own capture request.
 * These are the properties that make the replacement worth having: only the
 * picker's own window may answer, only a source that was offered may be
 * chosen, and nothing it is handed turns into a share on its own.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let nextContentsId = 1;

/** One fake window, standing in for the modal the picker opens. */
class FakeWindow extends EventEmitter {
  webContents = {
    id: nextContentsId++,
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  };
  destroyed = false;
  shown = false;
  loaded: string | null = null;
  static last: FakeWindow | null = null;
  constructor() {
    super();
    FakeWindow.last = this;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("closed");
  }
  show(): void {
    this.shown = true;
  }
  focus(): void {}
  loadFile(file: string): Promise<void> {
    this.loaded = file;
    return Promise.resolve();
  }
}

const ipc = new EventEmitter();

vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor() {
      return new FakeWindow() as unknown as object;
    }
  },
  ipcMain: {
    on: (channel: string, fn: (...a: unknown[]) => void) => ipc.on(channel, fn),
    removeListener: (channel: string, fn: (...a: unknown[]) => void) => ipc.removeListener(channel, fn),
  },
  nativeTheme: { shouldUseDarkColors: true },
}));

const { askForDisplaySource, displayPickerIsOpen } = await import("../src/main/displayPicker");

const SOURCES = [
  { id: "screen:0", name: "Entire screen", kind: "screen" as const, thumbnail: "" },
  { id: "window:12", name: "A window", kind: "window" as const, thumbnail: "" },
];

/** The picker's page coming up, and whatever it then sends back. */
function fromPicker(channel: string, payload?: unknown, sender?: { id: number }): void {
  const win = FakeWindow.last!;
  ipc.emit(channel, { sender: sender ?? win.webContents }, payload);
}

function ready(): void {
  fromPicker("picker:ready");
}

const parent = {} as never;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWindow.last = null;
});
afterEach(() => {
  vi.useRealTimers();
  ipc.removeAllListeners();
});

describe("the screen-share picker", () => {
  it("answers with a source the person chose", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    fromPicker("picker:choose", { sourceId: "window:12", withAudio: true });
    await expect(answer).resolves.toEqual({ sourceId: "window:12", withAudio: true });
  });

  it("refuses a source that was never offered", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    // the id of a screen that exists on the machine but was not in the list
    fromPicker("picker:choose", { sourceId: "screen:99", withAudio: true });
    await expect(answer).resolves.toBeNull();
  });

  it("ignores a message from any window but its own", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    fromPicker("picker:choose", { sourceId: "screen:0", withAudio: true }, { id: 9999 });
    // still waiting; the impostor changed nothing
    vi.advanceTimersByTime(119_000);
    fromPicker("picker:choose", { sourceId: "screen:0", withAudio: true });
    await expect(answer).resolves.toEqual({ sourceId: "screen:0", withAudio: true });
  });

  it("does not carry sound the request never asked for", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: false });
    ready();
    fromPicker("picker:choose", { sourceId: "screen:0", withAudio: true });
    await expect(answer).resolves.toEqual({ sourceId: "screen:0", withAudio: false });
  });

  it("gives up rather than holding the page's promise open for ever", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true, timeoutMs: 1000 });
    ready();
    vi.advanceTimersByTime(1001);
    await expect(answer).resolves.toBeNull();
  });

  it("shares nothing when the window is closed", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    FakeWindow.last!.emit("closed");
    await expect(answer).resolves.toBeNull();
  });

  it("shares nothing when the person cancels", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    fromPicker("picker:cancel");
    await expect(answer).resolves.toBeNull();
  });

  it("refuses a second request rather than stacking a window nobody asked for", async () => {
    const first = askForDisplaySource(parent, SOURCES, { audio: true });
    ready();
    await expect(askForDisplaySource(parent, SOURCES, { audio: true })).resolves.toBeNull();
    expect(displayPickerIsOpen()).toBe(true);
    fromPicker("picker:cancel");
    await expect(first).resolves.toBeNull();
    expect(displayPickerIsOpen()).toBe(false);
  });

  it("only shows the window once its page is up, so nothing flashes empty", async () => {
    const answer = askForDisplaySource(parent, SOURCES, { audio: true });
    expect(FakeWindow.last!.shown).toBe(false);
    ready();
    expect(FakeWindow.last!.shown).toBe(true);
    expect(FakeWindow.last!.webContents.send).toHaveBeenCalledWith("picker:ready", expect.objectContaining({ sources: SOURCES, audio: true }));
    fromPicker("picker:cancel");
    await answer;
  });
});
