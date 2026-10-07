// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { moduleLoader } from "@/lib/look/plugins/runtime";
import type { PluginEntry } from "@/lib/look/types";
import { registerPluginKeybind } from "@/lib/pluginKeybinds";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { PluginKeybinds } from "../PluginKeybinds";
import { AddPluginDialog } from "./AddPluginDialog";
import { PermissionLedger } from "./PermissionLedger";
import { PluginUpdateDialog } from "./PluginUpdateDialog";

const V2 = `export default { name: "Watcher", author: "Ann", version: "2.0.0", apiVersion: 2, permissions: ["servers.messages.read", "events.read", "stores"], start() {} };`;
const V1 = `export default { name: "Old", start() {} };`;
let loads = 0;

beforeEach(() => {
  loads = 0;
  moduleLoader.load = async (code: string) => {
    loads++;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return { default: new Function(`return (${code.replace(/^export default /, "").replace(/;\s*$/, "")});`)() as unknown };
  };
});
afterEach(cleanup);

async function toReview(code: string, editing?: { entry: PluginEntry; code: string }) {
  const onSave = vi.fn();
  render(<AddPluginDialog initial="code" pastedElsewhere={0} taken={[]} onClose={() => undefined} onSave={onSave} {...(editing ? { editing } : {})} />);
  fireEvent.change(screen.getByTestId("plugin-code"), { target: { value: code } });
  fireEvent.click(screen.getByTestId("plugin-continue"));
  await waitFor(() => expect(screen.getByTestId("plugin-review")).toBeTruthy());
  return onSave;
}

describe("adding a plugin", () => {
  it("shows a v2 plugin's permissions, runs nothing before the tick, and grants the whole list", async () => {
    const onSave = await toReview(V2);
    expect(screen.getByText("Watcher")).toBeTruthy();
    expect(screen.getByText("by Ann")).toBeTruthy();
    const rows = [...document.querySelectorAll("[data-permission]")].map((r) => [r.getAttribute("data-permission"), r.getAttribute("data-tone")]);
    expect(rows).toEqual([["servers.messages.read", null], ["events.read", null], ["stores", "danger"]]);
    expect(screen.getByText("Dangerous")).toBeTruthy();
    expect(loads).toBe(0);
    expect((screen.getByTestId("plugin-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("plugin-agree"));
    fireEvent.click(screen.getByTestId("plugin-add"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(loads).toBe(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ permissions: ["servers.messages.read", "events.read", "stores"], meta: { name: "Watcher" } });
  });

  it("warns that an old plugin has full access, and gives it no list", async () => {
    const onSave = await toReview(V1);
    expect(document.querySelector("[data-permission]")).toBeNull();
    expect(screen.getByTestId("plugin-caution").textContent).toMatch(/full access/);
    fireEvent.click(screen.getByTestId("plugin-agree"));
    fireEvent.click(screen.getByTestId("plugin-add"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].permissions).toBeUndefined();
  });

  it("marks what new code asks for anew, says what it no longer asks for, and keeps the rest", async () => {
    const entry = { id: "abcdefghij", source: "code", url: null, code: "x", hash: "0".repeat(64), enabled: true, settings: {}, meta: null, addedAt: 1, permissions: ["events.read", "ui.write"] } as PluginEntry;
    const onSave = await toReview(V2, { entry, code: V2 });
    const fresh = [...document.querySelectorAll('[data-tone="new"][data-permission]')].map((r) => r.getAttribute("data-permission"));
    expect(fresh).toEqual(["servers.messages.read"]);
    expect(screen.getByText(/no longer asks for: Show Things and Change Menus/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("plugin-agree"));
    fireEvent.click(screen.getByTestId("plugin-add"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].permissions).toEqual(["events.read", "servers.messages.read", "stores"]);
  });
});

describe("a link plugin's update", () => {
  it("shows what it asks for anew, and accepting grants what it showed", () => {
    const onAccept = vi.fn();
    const entry = { id: "abcdefghij", source: "url", url: "https://example.com/p.js", code: null, hash: "0".repeat(64), enabled: true, settings: {}, meta: null, addedAt: 1, permissions: ["events.read"] } as PluginEntry;
    render(<PluginUpdateDialog entry={entry} name="Watcher" update={{ hash: "1".repeat(64), size: 10, code: V2 }} onClose={() => undefined} onAccept={onAccept} onKeep={() => undefined} />);
    expect([...document.querySelectorAll("[data-permission]")].map((r) => r.getAttribute("data-permission"))).toEqual(["servers.messages.read", "stores"]);
    fireEvent.click(screen.getByTestId("plugin-update-agree"));
    fireEvent.click(screen.getByTestId("plugin-update-accept"));
    expect(onAccept).toHaveBeenCalledWith(["events.read", "servers.messages.read", "stores"]);
  });
});

describe("the permission ledger's switches", () => {
  it("gives and takes each permission", () => {
    const onChange = vi.fn();
    render(<PermissionLedger permissions={["users.read", "ui.write"]} switches={{ granted: new Set(["users.read"]), plugin: "Watcher", onChange }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Read Profiles for Watcher" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Things and Change Menus for Watcher" }));
    expect(onChange.mock.calls).toEqual([["users.read", false], ["ui.write", true]]);
  });
});

describe("plugin keybinds in Settings", () => {
  beforeEach(() => useSettings.setState((s) => ({ settings: { ...s.settings, keybinds: {}, pluginKeybinds: {}, plugins: [{ id: "p1" }, { id: "p2" }] as never } })));

  it("records keys for a running plugin's keybind, and points out keys something else has", () => {
    const a = registerPluginKeybind("p1", "Watcher", "go", { name: "Go", description: "Goes" }, () => undefined);
    render(<PluginKeybinds />);
    expect(screen.getByText("Watcher")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plugin-keybind-change"));
    fireEvent.keyDown(window, { code: "KeyM", key: "M", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("alert").textContent).toMatch(/already the key for/);
    fireEvent.keyDown(window, { code: "KeyG", key: "g", altKey: true });
    expect(useSettings.getState().settings.pluginKeybinds).toEqual({ p1: { go: "Alt+KeyG" } });
    a();
  });
});

describe("a warning toast and a plugin's menu icon", () => {
  it("draws a warning toast as one, and a plugin button's icon in a menu", async () => {
    useUI.setState({ toasts: [] });
    render(
      <>
        <Toasts />
        <ContextMenuHost />
      </>,
    );
    act(() => useUI.getState().toast("careful", "warning"));
    expect(screen.getByText("careful").closest("button")!.className).toMatch(/warning/);
    act(() => useUI.getState().openContextMenu({ x: 10, y: 10, items: [{ id: "a", label: "Love It", icon: "heart", onSelect: () => undefined }, { id: "b", label: "Nothing", icon: "no-such-icon", onSelect: () => undefined }] }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Love It" }).querySelector("svg")).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: "Nothing" }).querySelector("svg")).toBeNull();
  });
});
