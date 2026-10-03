/**
 * System-wide shortcuts: the keybinds the page asks for (Settings, Keybinds),
 * held while the app runs so they answer with another window in front, a game
 * or a browser or anything else. Each press is passed to the page, which does
 * what the bind is for. A key another program already holds cannot be taken
 * from it, and the page is told which, so it can say so.
 *
 * Only presses come through: the system says when a shortcut is pressed but
 * not when it is let go, so push to talk stays a key held in the window.
 */

export const SHORTCUT_ACTIONS = ["mute", "deafen", "activity"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutRequest {
  action: ShortcutAction;
  /** Electron's way of writing a key and its modifiers: "CommandOrControl+Shift+M". */
  accelerator: string;
}

export interface ShortcutResult {
  action: ShortcutAction;
  /** False when the system would not give the key: another program holds it. */
  ok: boolean;
}

/** What a shortcut is taken and given back with: Electron's globalShortcut, or a stand-in in tests. */
export interface ShortcutSystem {
  register(accelerator: string, fn: () => void): boolean;
  unregisterAll(): void;
}

const MODIFIER = "(?:CommandOrControl|Control|Alt|Shift)";
const KEY = "(?:[A-Za-z0-9]{1,20}|[`\\-=[\\]\\\\;',./])";
const ACCELERATOR = new RegExp(`^(?:${MODIFIER}\\+){0,4}${KEY}$`);

/** What the page sent, kept to what can be a shortcut: one per action, each well formed. */
export function cleanRequests(list: unknown): ShortcutRequest[] {
  if (!Array.isArray(list)) return [];
  const out: ShortcutRequest[] = [];
  for (const item of list.slice(0, SHORTCUT_ACTIONS.length * 2)) {
    if (!item || typeof item !== "object") continue;
    const { action, accelerator } = item as Record<string, unknown>;
    if (typeof action !== "string" || !(SHORTCUT_ACTIONS as readonly string[]).includes(action)) continue;
    if (typeof accelerator !== "string" || accelerator.length > 64 || !ACCELERATOR.test(accelerator)) continue;
    if (out.some((r) => r.action === action || r.accelerator.toLowerCase() === accelerator.toLowerCase())) continue;
    out.push({ action: action as ShortcutAction, accelerator });
  }
  return out;
}

/**
 * Lets go of the shortcuts held before and takes these, each passing its
 * presses to `fire`. Says which the system gave.
 */
export function applyShortcuts(system: ShortcutSystem, requests: ShortcutRequest[], fire: (action: ShortcutAction) => void): ShortcutResult[] {
  system.unregisterAll();
  return requests.map(({ action, accelerator }) => {
    let ok = false;
    try {
      ok = system.register(accelerator, () => fire(action));
    } catch {
      // a key the system has no name for on this platform
      ok = false;
    }
    return { action, ok };
  });
}
