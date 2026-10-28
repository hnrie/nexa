import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { isPackaged: true } }));
import { originalWindow, lockOriginalWindow } from "../src/main/originalWindow";
import type { BrowserWindow } from "electron";

describe("Open Original", () => {
  it("opens an app blob in an isolated, scriptless window with no preload or bridge", () => {
    const result = originalWindow("blob:https://nexa.fish/1234");
    expect(result?.action).toBe("allow");
    expect(result?.overrideBrowserWindowOptions?.webPreferences).toMatchObject({
      javascript: false, sandbox: true, nodeIntegration: false,
      contextIsolation: true, preload: undefined, additionalArguments: [],
    });
  });
  it("does not turn arbitrary links or another origin's blobs into app windows", () => {
    for (const url of ["blob:https://evil.test/1", "data:text/html,hi", "file:///tmp/picture.png", "https://nexa.fish/", "invalid"]) expect(originalWindow(url)).toBeNull();
  });
  it("blocks further windows and navigation from an original", () => {
    const on = vi.fn();
    const setWindowOpenHandler = vi.fn();
    lockOriginalWindow({ webContents: { on, setWindowOpenHandler } } as unknown as BrowserWindow, "blob:https://nexa.fish/1234");
    expect(setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: "deny" });
    expect(on.mock.calls.map(([name]) => name)).toEqual(["will-navigate", "will-frame-navigate", "will-redirect"]);
    for (const [, handler] of on.mock.calls) {
      const preventDefault = vi.fn();
      handler({ preventDefault, url: "https://evil.test/" }, "https://evil.test/");
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    // did-create-window precedes the blob's first navigation.
    for (const [name, handler] of on.mock.calls) {
      if (name === "will-redirect") continue;
      const preventDefault = vi.fn();
      handler({ preventDefault, url: "blob:https://nexa.fish/1234" }, "blob:https://nexa.fish/1234");
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
});
