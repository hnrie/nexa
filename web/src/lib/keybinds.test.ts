import { describe, expect, it } from "vitest";
import { accelerator, actionFor, bindable, bindKeys, bindText, comboOf, DEFAULT_KEYBINDS, firstOfPress, formatBind, keybindsOf, parseBind, reservedBy, sanitizeKeybinds } from "./keybinds";

const press = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("binds", () => {
  it("are written one way, whatever order they come in", () => {
    expect(formatBind(parseBind("Shift+Mod+KeyM")!)).toBe("Mod+Shift+KeyM");
    expect(parseBind("Mod+Shift+KeyM")).toEqual({ mod: true, ctrl: false, alt: false, shift: true, code: "KeyM" });
  });

  it("are no bind when malformed", () => {
    for (const bad of ["", "Mod+", "Hyper+KeyM", "Mod+ShiftLeft", "Mod+Key M", 5, null]) expect(parseBind(bad as string)).toBeNull();
  });

  it("come from a key press by where the key is, Ctrl on a PC and ⌘ on a Mac", () => {
    expect(formatBind(comboOf(press("KeyM", { ctrlKey: true, shiftKey: true }), false)!)).toBe("Mod+Shift+KeyM");
    expect(formatBind(comboOf(press("KeyM", { metaKey: true, shiftKey: true }), true)!)).toBe("Mod+Shift+KeyM");
    // a Mac's Control key is a modifier of its own
    expect(formatBind(comboOf(press("KeyM", { ctrlKey: true }), true)!)).toBe("Ctrl+KeyM");
    // a modifier on its own is not yet a bind
    expect(comboOf(press("ShiftLeft", { shiftKey: true }), false)).toBeNull();
  });

  it("need a modifier, unless the key types nothing", () => {
    expect(bindable(parseBind("KeyM")!)).toBe(false);
    expect(bindable(parseBind("Shift+KeyM")!)).toBe(false);
    expect(bindable(parseBind("Alt+KeyM")!)).toBe(true);
    expect(bindable(parseBind("F8")!)).toBe(true);
    expect(bindable(parseBind("MediaPlayPause")!)).toBe(true);
  });

  it("read as keys", () => {
    expect(bindKeys(parseBind("Mod+Shift+KeyM")!, false)).toEqual(["Ctrl", "Shift", "M"]);
    expect(bindKeys(parseBind("Mod+Shift+KeyM")!, true)).toEqual(["⇧", "⌘", "M"]);
    expect(bindText("Mod+Alt+Backquote", false)).toBe("Ctrl+Alt+`");
    expect(bindText("", false)).toBe("");
  });

  it("become the desktop app's system-wide shortcuts", () => {
    expect(accelerator("Mod+Shift+KeyM", false)).toBe("CommandOrControl+Shift+M");
    expect(accelerator("Ctrl+Alt+Digit1", true)).toBe("Control+Alt+1");
    expect(accelerator("F8", false)).toBe("F8");
    expect(accelerator("Mod+ArrowUp", false)).toBe("CommandOrControl+Up");
    expect(accelerator("Mod+IntlRo", false)).toBeNull();
  });

  it("leave Nexa's own keys alone", () => {
    expect(reservedBy(parseBind("Mod+KeyK")!)).toBe("modals.shortcutsHelp.quickSwitcherJumpToAnyConversation");
    expect(reservedBy(parseBind("Mod+Shift+KeyM")!)).toBeNull();
  });
});

describe("the account's binds", () => {
  it("are the defaults until changed, and a key taken off stays off", () => {
    expect(keybindsOf({})).toEqual(DEFAULT_KEYBINDS);
    expect(keybindsOf({ mute: "", activity: "Alt+KeyA" })).toEqual({ mute: "", deafen: "Mod+Shift+KeyD", activity: "Alt+KeyA" });
  });

  it("are read defensively from what was saved", () => {
    expect(sanitizeKeybinds({ mute: "Shift+Mod+KeyM", deafen: 3, quit: "Mod+KeyQ", activity: "" })).toEqual({ mute: "Mod+Shift+KeyM", activity: "" });
    expect(sanitizeKeybinds("nope")).toEqual({});
  });

  it("say which action a key press is for", () => {
    const binds = keybindsOf({ activity: "Alt+KeyA" });
    expect(actionFor(binds, comboOf(press("KeyD", { ctrlKey: true, shiftKey: true }), false))).toBe("deafen");
    expect(actionFor(binds, comboOf(press("KeyA", { altKey: true }), false))).toBe("activity");
    expect(actionFor(binds, comboOf(press("KeyA", { altKey: true, shiftKey: true }), false))).toBeNull();
  });

  it("act once for a press that arrives twice", () => {
    expect(firstOfPress("mute", 10_000)).toBe(true);
    expect(firstOfPress("mute", 10_100)).toBe(false);
    expect(firstOfPress("mute", 11_000)).toBe(true);
    expect(firstOfPress("deafen", 11_050)).toBe(true);
  });
});
