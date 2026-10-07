/**
 * Keybinds: the keys someone picks for muting, deafening and sharing their
 * activity, kept with the account (settings.keybinds) so every device has
 * them, and in the desktop app answered even while another window is in front
 * (components/desktop/DesktopEffects.tsx).
 *
 * A bind is written "Mod+Shift+KeyM": its modifiers, then the key's code. A
 * code names a place on the keyboard rather than the letter printed on it, so
 * a bind made on one layout presses the same key on another, and Shift never
 * turns "m" into "M". "Mod" is Ctrl, or ⌘ on a Mac, so one bind works on
 * both; "Ctrl" written out is a Mac's Control key, which ⌘ leaves free.
 */
import { t } from "@/i18n";

export type KeybindAction = "mute" | "deafen" | "activity";
export type Keybinds = Record<KeybindAction, string>;

export const KEYBIND_ACTIONS: KeybindAction[] = ["mute", "deafen", "activity"];

/** What a new account starts with: the two keys mute and deafen always had, and nothing for activity. */
export const DEFAULT_KEYBINDS: Keybinds = { mute: "Mod+Shift+KeyM", deafen: "Mod+Shift+KeyD", activity: "" };

export interface Combo {
  /** Ctrl, or ⌘ on a Mac. */
  mod: boolean;
  /** A Mac's Control key; never set elsewhere, where Ctrl is Mod. */
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.code: "KeyM", "Digit1", "F5", "Backquote". */
  code: string;
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

const MODIFIER_CODES = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "Fn", "FnLock"]);
const CODE = /^[A-Za-z0-9]{1,24}$/;

/** A stored bind, read defensively: anything but a well-formed one is no bind. */
export function parseBind(bind: string | null | undefined): Combo | null {
  if (typeof bind !== "string" || !bind) return null;
  const parts = bind.split("+");
  const code = parts.pop() ?? "";
  if (!CODE.test(code) || MODIFIER_CODES.has(code)) return null;
  const c: Combo = { mod: false, ctrl: false, alt: false, shift: false, code };
  for (const p of parts) {
    if (p === "Mod") c.mod = true;
    else if (p === "Ctrl") c.ctrl = true;
    else if (p === "Alt") c.alt = true;
    else if (p === "Shift") c.shift = true;
    else return null;
  }
  return c;
}

/** The one way a combination is written, so two that mean the same are the same string. */
export function formatBind(c: Combo): string {
  return [c.mod ? "Mod" : "", c.ctrl ? "Ctrl" : "", c.alt ? "Alt" : "", c.shift ? "Shift" : "", c.code].filter(Boolean).join("+");
}

/** The combination a key press makes, or null for a modifier pressed on its own. */
export function comboOf(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, mac = isMac()): Combo | null {
  if (!e.code || MODIFIER_CODES.has(e.code) || !CODE.test(e.code)) return null;
  return { mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac ? e.ctrlKey : false, alt: e.altKey, shift: e.shiftKey, code: e.code };
}

export function sameCombo(a: Combo | null, b: Combo | null): boolean {
  return !!a && !!b && a.code === b.code && a.mod === b.mod && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;
}

/** Keys that do nothing of their own in a text box, so a bind may be just one of them. */
export function standsAlone(code: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(code) || code.startsWith("Media") || code.startsWith("Audio") || code === "Pause" || code === "ScrollLock" || code === "PrintScreen";
}

/** Whether a combination can be a bind: a letter alone would fire in the middle of every message typed. */
export function bindable(c: Combo): boolean {
  return c.mod || c.ctrl || c.alt || standsAlone(c.code);
}

/** The keyboard's own labels for its keys, where the browser will say (Chromium): an "A" where AZERTY puts it. */
let layout: Map<string, string> | null = null;
export function learnLayout(): void {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  void kb?.getLayoutMap?.()
    .then((m) => {
      layout = m;
    })
    .catch(() => undefined);
}

const NAMED: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "\\",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Escape: "Esc",
  Delete: "Del",
  Insert: "Ins",
  PrintScreen: "PrtSc",
  ScrollLock: "ScrLk",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
  MediaPlayPause: "⏯",
  MediaTrackNext: "⏭",
  MediaTrackPrevious: "⏮",
  MediaStop: "⏹",
  AudioVolumeMute: "🔇",
  AudioVolumeDown: "🔉",
  AudioVolumeUp: "🔊",
};

/** What is printed on a key, as near as can be told. */
export function keyName(code: string): string {
  const printed = layout?.get(code);
  if (printed && printed.trim()) return printed.length === 1 ? printed.toUpperCase() : printed;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  if (code === "Space") return t("keybinds.keys.space");
  if (code === "Enter") return t("keybinds.keys.enter");
  if (code === "Backspace") return t("keybinds.keys.backspace");
  if (code === "Tab") return "Tab";
  return NAMED[code] ?? code;
}

/** The keycaps a bind shows: "Ctrl", "Shift", "M", or "⌘", "⇧", "M" on a Mac. */
export function bindKeys(c: Combo, mac = isMac()): string[] {
  const keys: string[] = [];
  if (mac) {
    if (c.ctrl) keys.push("⌃");
    if (c.alt) keys.push("⌥");
    if (c.shift) keys.push("⇧");
    if (c.mod) keys.push("⌘");
  } else {
    if (c.mod) keys.push("Ctrl");
    if (c.alt) keys.push("Alt");
    if (c.shift) keys.push("Shift");
  }
  keys.push(keyName(c.code));
  return keys;
}

/** A bind as one line of text, for a tooltip or a menu: "Ctrl+Shift+M", "⌘⇧M". */
export function bindText(bind: string | null | undefined, mac = isMac()): string {
  const c = parseBind(bind);
  if (!c) return "";
  const keys = bindKeys(c, mac);
  return mac ? keys.join("") : keys.join("+");
}

const ACCEL_NAMED: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Escape",
  PrintScreen: "PrintScreen",
  ScrollLock: "Scrolllock",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
  MediaPlayPause: "MediaPlayPause",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  MediaStop: "MediaStop",
  AudioVolumeMute: "VolumeMute",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeUp: "VolumeUp",
};

/**
 * The bind as the desktop app's system-wide shortcuts write it (Electron's
 * accelerators), or null for a key they cannot name. An accelerator names a
 * key by what it prints on a US keyboard, so a bind made on another layout
 * still answers to the key in the same place.
 */
export function accelerator(bind: string | null | undefined, mac = isMac()): string | null {
  const c = parseBind(bind);
  if (!c) return null;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(c.code)) key = c.code.slice(3);
  else if (/^Digit\d$/.test(c.code)) key = c.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c.code)) key = c.code;
  else if (/^Numpad\d$/.test(c.code)) key = `num${c.code.slice(6)}`;
  else key = ACCEL_NAMED[c.code] ?? null;
  if (!key) return null;
  const mods: string[] = [];
  if (c.mod) mods.push("CommandOrControl");
  if (c.ctrl && mac) mods.push("Control");
  if (c.alt) mods.push("Alt");
  if (c.shift) mods.push("Shift");
  return [...mods, key].join("+");
}

/**
 * Keys Nexa already answers to for something else, and what: a bind on one
 * of them would take it away. Formatting keys only count in a message box,
 * but a bind fires there too.
 */
const RESERVED: [string, string][] = [
  ["Mod+KeyK", "modals.shortcutsHelp.quickSwitcherJumpToAnyConversation"],
  ["Mod+Slash", "modals.shortcutsHelp.thisList"],
  ["Mod+KeyE", "modals.shortcutsHelp.openTheEmojiPicker"],
  ["Mod+KeyB", "modals.shortcutsHelp.boldItalicUnderline"],
  ["Mod+KeyI", "modals.shortcutsHelp.boldItalicUnderline"],
  ["Mod+KeyU", "modals.shortcutsHelp.boldItalicUnderline"],
  ["Mod+Shift+KeyX", "modals.shortcutsHelp.strikeThrough"],
  ["Mod+Enter", "modals.shortcutsHelp.sendFromEditor"],
  ["Mod+Alt+ArrowLeft", "modals.shortcutsHelp.switchTabs"],
  ["Mod+Alt+ArrowRight", "modals.shortcutsHelp.switchTabs"],
  ["Mod+Alt+KeyW", "modals.shortcutsHelp.closeTheOpenTab"],
  ["Alt+ArrowUp", "modals.shortcutsHelp.previousNextConversation"],
  ["Alt+ArrowDown", "modals.shortcutsHelp.previousNextConversation"],
  ["Shift+PageUp", "modals.shortcutsHelp.scrollTheMessages"],
  ["Shift+PageDown", "modals.shortcutsHelp.scrollTheMessages"],
  ["Mod+KeyC", "textMenu.copy"],
  ["Mod+KeyV", "textMenu.paste"],
  ["Mod+KeyX", "textMenu.cut"],
  ["Mod+KeyA", "textMenu.selectAll"],
  ["Mod+KeyZ", "textMenu.undo"],
  ["Mod+KeyY", "textMenu.redo"],
  ["Mod+Shift+KeyZ", "textMenu.redo"],
  ["Mod+KeyR", "shell.errorBoundary.reload"],
];

/** The i18n key of what Nexa does with this combination already, or null when it is free. */
export function reservedBy(c: Combo): string | null {
  const bind = formatBind(c);
  return RESERVED.find(([b]) => b === bind)?.[1] ?? null;
}

/** Stored binds, read defensively: only the actions there are, each a bind or "" for none. */
export function sanitizeKeybinds(x: unknown): Partial<Keybinds> {
  const out: Partial<Keybinds> = {};
  if (!x || typeof x !== "object") return out;
  for (const a of KEYBIND_ACTIONS) {
    const v = (x as Record<string, unknown>)[a];
    if (v === "") out[a] = "";
    else if (typeof v === "string") {
      const c = parseBind(v);
      if (c) out[a] = formatBind(c);
    }
  }
  return out;
}

/** The account's binds: what it chose, and the defaults for anything it never set. */
export function keybindsOf(saved: Partial<Keybinds> | null | undefined): Keybinds {
  const out = { ...DEFAULT_KEYBINDS };
  if (!saved || typeof saved !== "object") return out;
  for (const a of KEYBIND_ACTIONS) {
    const v = saved[a];
    // "" is a bind taken off on purpose, which a default must not come back over
    if (v === "") out[a] = "";
    else if (typeof v === "string" && parseBind(v)) out[a] = formatBind(parseBind(v)!);
  }
  return out;
}

/** Which action a key press is the bind for, if any. */
export function actionFor(binds: Keybinds, c: Combo | null): KeybindAction | null {
  if (!c) return null;
  return KEYBIND_ACTIONS.find((a) => sameCombo(parseBind(binds[a]), c)) ?? null;
}

/**
 * Once each: a bind pressed while the app is in front can reach the page both
 * as a key press and from the desktop app's system-wide shortcut, and two
 * toggles are no toggle at all. A second one within this long is the same press.
 */
const lastRun: Partial<Record<KeybindAction, number>> = {};
export function firstOfPress(action: KeybindAction, now = Date.now()): boolean {
  const last = lastRun[action] ?? 0;
  lastRun[action] = now;
  return now - last > 300;
}

/** The keys people chose for plugins' keybinds: by plugin id, then by the keybind's id within it. */
export type PluginKeybinds = Record<string, Record<string, string>>;

const PLUGIN_BIND_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Plugins' binds as stored, read defensively: each a bind the app could make,
 * for a plugin the account still has (a deleted plugin's keys are forgotten),
 * and not too many of them.
 */
export function sanitizePluginKeybinds(x: unknown, pluginIds: Iterable<string>): PluginKeybinds {
  const out: PluginKeybinds = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  const known = new Set(pluginIds);
  for (const [pluginId, binds] of Object.entries(x as Record<string, unknown>)) {
    if (!known.has(pluginId) || !binds || typeof binds !== "object" || Array.isArray(binds)) continue;
    const kept: Record<string, string> = {};
    for (const [id, bind] of Object.entries(binds as Record<string, unknown>).slice(0, 50)) {
      const c = typeof bind === "string" ? parseBind(bind) : null;
      if (PLUGIN_BIND_ID.test(id) && c) kept[id] = formatBind(c);
    }
    if (Object.keys(kept).length) out[pluginId] = kept;
  }
  return out;
}
