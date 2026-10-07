import { create } from "zustand";
import { useSettings } from "@/stores/settings";
import { parseBind, sameCombo, type Combo } from "./keybinds";

/**
 * The keybinds running plugins have registered (the v2 plugin API's
 * `keybinds`), with what Settings, Keybinds shows of them, and what each does.
 * The keys people chose are kept apart, in the account's settings
 * (`pluginKeybinds`), so they stay while a plugin is off and come back when
 * it starts again. Plugin keybinds answer in the app's window only; the
 * desktop app's system-wide keys stay for mute, deafen and activity.
 */

export interface PluginKeybindInfo {
  name: string;
  description: string;
}

interface State {
  /** By plugin id: the plugin's name, and its keybinds by their own id. */
  byPlugin: Record<string, { plugin: string; keybinds: Record<string, PluginKeybindInfo> }>;
}

export const usePluginKeybinds = create<State>()(() => ({ byPlugin: {} }));

const handlers = new Map<string, () => void>();
const key = (pluginId: string, id: string) => `${pluginId}\u0000${id}`;

/** Registers a plugin's keybind; throws when the plugin has one with this id already. Returns a function that takes it away. */
export function registerPluginKeybind(pluginId: string, plugin: string, id: string, info: PluginKeybindInfo, run: () => void): () => void {
  const k = key(pluginId, id);
  if (handlers.has(k)) throw new Error(`the keybind "${id}" is registered already`);
  handlers.set(k, run);
  usePluginKeybinds.setState((s) => {
    const was = s.byPlugin[pluginId];
    return { byPlugin: { ...s.byPlugin, [pluginId]: { plugin, keybinds: { ...(was?.keybinds ?? {}), [id]: info } } } };
  });
  return () => {
    if (handlers.get(k) !== run) return;
    handlers.delete(k);
    usePluginKeybinds.setState((s) => {
      const was = s.byPlugin[pluginId];
      if (!was) return s;
      const keybinds = { ...was.keybinds };
      delete keybinds[id];
      const byPlugin = { ...s.byPlugin };
      if (Object.keys(keybinds).length) byPlugin[pluginId] = { plugin, keybinds };
      else delete byPlugin[pluginId];
      return { byPlugin };
    });
  };
}

/** The keys chosen for a plugin's keybind, as stored ("Mod+Shift+KeyK"), or null when it is unbound. */
export function pluginBind(pluginId: string, id: string): string | null {
  return useSettings.getState().settings.pluginKeybinds[pluginId]?.[id] ?? null;
}

/** A second press within this long is the same press (a key held down repeats). */
const lastRun = new Map<string, number>();

/**
 * Runs every running plugin's keybind bound to this combination; says whether
 * any was. Held down, a key is one press.
 */
export function runPluginKeybinds(c: Combo | null, repeat = false, now = Date.now()): boolean {
  if (!c || handlers.size === 0) return false;
  const binds = useSettings.getState().settings.pluginKeybinds;
  let any = false;
  for (const [k, run] of [...handlers]) {
    const [pluginId, id] = k.split("\u0000") as [string, string];
    if (!sameCombo(parseBind(binds[pluginId]?.[id]), c)) continue;
    any = true;
    const last = lastRun.get(k) ?? 0;
    lastRun.set(k, now);
    if (repeat || now - last < 300) continue;
    try {
      run();
    } catch (err) {
      console.warn("a plugin's keybind failed", err);
    }
  }
  return any;
}
