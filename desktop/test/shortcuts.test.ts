import { describe, expect, it } from "vitest";
import { applyShortcuts, cleanRequests, type ShortcutSystem } from "../src/main/shortcuts";

describe("cleanRequests", () => {
  it("keeps one well-formed shortcut per action", () => {
    expect(
      cleanRequests([
        { action: "mute", accelerator: "CommandOrControl+Shift+M" },
        { action: "mute", accelerator: "CommandOrControl+Shift+N" },
        { action: "deafen", accelerator: "Alt+F9" },
        { action: "activity", accelerator: "Control+Alt+`" },
      ]),
    ).toEqual([
      { action: "mute", accelerator: "CommandOrControl+Shift+M" },
      { action: "deafen", accelerator: "Alt+F9" },
      { action: "activity", accelerator: "Control+Alt+`" },
    ]);
  });

  it("drops what is not a shortcut, or not one the page may ask for", () => {
    expect(
      cleanRequests([
        { action: "quit", accelerator: "CommandOrControl+Q" },
        { action: "mute", accelerator: "CommandOrControl+Shift+M; rm -rf" },
        { action: "deafen", accelerator: "Super+D" },
        { action: "activity", accelerator: 5 },
        null,
        "mute",
      ]),
    ).toEqual([]);
    expect(cleanRequests("nope")).toEqual([]);
  });

  it("does not let two actions share a key", () => {
    expect(
      cleanRequests([
        { action: "mute", accelerator: "CommandOrControl+Shift+M" },
        { action: "deafen", accelerator: "commandorcontrol+shift+m" },
      ]),
    ).toEqual([{ action: "mute", accelerator: "CommandOrControl+Shift+M" }]);
  });
});

describe("applyShortcuts", () => {
  it("lets go of the old ones, takes the new, and says which the system gave", () => {
    const held = new Map<string, () => void>();
    let cleared = 0;
    const system: ShortcutSystem = {
      register: (accel, fn) => {
        if (accel === "Alt+F9") return false; // another program has it
        held.set(accel, fn);
        return true;
      },
      unregisterAll: () => {
        cleared++;
        held.clear();
      },
    };
    const fired: string[] = [];
    const res = applyShortcuts(
      system,
      [
        { action: "mute", accelerator: "CommandOrControl+Shift+M" },
        { action: "deafen", accelerator: "Alt+F9" },
      ],
      (a) => fired.push(a),
    );
    expect(cleared).toBe(1);
    expect(res).toEqual([
      { action: "mute", ok: true },
      { action: "deafen", ok: false },
    ]);
    held.get("CommandOrControl+Shift+M")!();
    expect(fired).toEqual(["mute"]);
  });

  it("treats a key the system cannot name as not given", () => {
    const system: ShortcutSystem = {
      register: () => {
        throw new Error("bad accelerator");
      },
      unregisterAll: () => {},
    };
    expect(applyShortcuts(system, [{ action: "mute", accelerator: "CommandOrControl+Shift+M" }], () => {})).toEqual([{ action: "mute", ok: false }]);
  });
});
