import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "@/stores/settings";
import { parseBind } from "./keybinds";
import { bindClash, pluginBind, registerPluginKeybind, runPluginKeybinds, setPluginBind } from "./pluginKeybinds";

beforeEach(() => {
  useSettings.setState((s) => ({ settings: { ...s.settings, keybinds: {}, pluginKeybinds: {}, plugins: [{ id: "p1" }, { id: "p2" }] as never } }));
});

describe("plugin keybinds", () => {
  it("saves keys with the account, and takes them off", () => {
    setPluginBind("p1", "go", "Alt+KeyG");
    expect(pluginBind("p1", "go")).toBe("Alt+KeyG");
    setPluginBind("p1", "go", null);
    expect(pluginBind("p1", "go")).toBeNull();
    expect(useSettings.getState().settings.pluginKeybinds).toEqual({});
  });

  it("points out the app's keybind or another plugin's on the same keys", () => {
    const stop = registerPluginKeybind("p2", "Other", "wave", { name: "Wave", description: "" }, () => undefined);
    setPluginBind("p2", "wave", "Alt+KeyW");
    expect(bindClash(parseBind("Mod+Shift+KeyM")!, { pluginId: "p1", id: "go" })).toEqual({ kind: "app", action: "mute" });
    expect(bindClash(parseBind("Alt+KeyW")!, { pluginId: "p1", id: "go" })).toEqual({ kind: "plugin", pluginId: "p2", id: "wave", plugin: "Other", name: "Wave" });
    expect(bindClash(parseBind("Alt+KeyW")!, { pluginId: "p2", id: "wave" })).toBeNull();
    expect(bindClash(parseBind("Alt+KeyQ")!, { pluginId: "p1", id: "go" })).toBeNull();
    stop();
  });

  it("runs every keybind on the keys pressed, and one that throws stops none", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ran: string[] = [];
    const a = registerPluginKeybind("p1", "One", "a", { name: "A", description: "" }, () => { throw new Error("no"); });
    const b = registerPluginKeybind("p2", "Two", "b", { name: "B", description: "" }, () => ran.push("b"));
    setPluginBind("p1", "a", "Alt+KeyZ");
    setPluginBind("p2", "b", "Alt+KeyZ");
    expect(runPluginKeybinds(parseBind("Alt+KeyZ"), false, 50_000)).toBe(true);
    expect(ran).toEqual(["b"]);
    a();
    b();
    expect(runPluginKeybinds(parseBind("Alt+KeyZ"), false, 60_000)).toBe(false);
  });
});
