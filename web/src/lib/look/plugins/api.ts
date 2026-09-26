/**
 * The Nexa plugin API, version 1: what a plugin's start() is handed. This is
 * the stable surface docs/plugins.md describes; anything a plugin reaches for
 * outside it (`unsupported`, the page itself) can change in any release.
 */

export const PLUGIN_API_VERSION = 1;

/** A message as plugins see it: decrypted on this device, never on the server. */
export interface PluginMessage {
  id: string;
  channelId: string;
  /** The server it was sent in; null in a direct or group conversation. */
  serverId: string | null;
  authorId: string;
  /** The text, decrypted. Empty for a message with none, or one this device could not decrypt. */
  content: string;
  /** False when this device has no key for it (yet). */
  decrypted: boolean;
  attachments: { name: string; type: string; size: number }[];
  sticker: { id: string; name: string } | null;
  replyToId: string | null;
  mentions: string[];
  createdAt: number;
  editedAt: number | null;
  /** Sent by the account the plugin runs in. */
  mine: boolean;
}

export interface PluginEvents {
  messageCreate: PluginMessage;
  messageUpdate: PluginMessage;
  /** `message` is the message as it was, when this device had it loaded. */
  messageDelete: { id: string; channelId: string; message: PluginMessage | null };
}
export type PluginEventName = keyof PluginEvents;

export interface PluginCommandContext {
  /** The conversation the command was typed in. */
  channelId: string;
}

export interface PluginCommandDef {
  /** Typed after a slash: letters, digits, - and _, up to 32. */
  name: string;
  description?: string;
  /** Returns the message to send in its place, or nothing to send nothing. */
  run: (args: string, ctx: PluginCommandContext) => string | void | null | Promise<string | void | null>;
}

export type PluginSetting =
  | { key: string; type: "toggle"; label: string; description?: string; default?: boolean }
  | { key: string; type: "text"; label: string; description?: string; default?: string; placeholder?: string; maxLength?: number }
  | { key: string; type: "number"; label: string; description?: string; default?: number; min?: number; max?: number; step?: number }
  | { key: string; type: "select"; label: string; description?: string; default?: string; options: { value: string; label: string }[] }
  | { key: string; type: "color"; label: string; description?: string; default?: string };

export type SettingValue = string | number | boolean;

export interface NexaPluginApi {
  apiVersion: number;
  /** This plugin, as Nexa knows it. */
  plugin: { id: string; name: string; version: string };
  app: { name: string; build: string; readonly locale: string };
  /** The signed-in account; null only in the moment around signing out. */
  readonly me: { id: string; username: string; displayName: string } | null;
  css: {
    /** Adds a stylesheet; call what it returns to take it away again. Removed when the plugin stops. */
    add(css: string): () => void;
    /** Takes away every stylesheet this plugin added. */
    clear(): void;
  };
  /** A short message at the bottom of the screen, under the plugin's name. */
  toast(text: string, kind?: "info" | "success" | "error"): void;
  /** Goes to a page of the app, such as "/channels/@me". */
  navigate(path: string): void;
  events: {
    /** Call what it returns to stop listening. Every listener is dropped when the plugin stops. */
    on<E extends PluginEventName>(event: E, handler: (payload: PluginEvents[E]) => void): () => void;
  };
  commands: {
    /** Adds a slash command to the message box. Gone when the plugin stops. */
    register(def: PluginCommandDef): () => void;
  };
  /** Kept on this device only, per account and plugin. Values must survive JSON. */
  storage: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    remove(key: string): void;
    keys(): string[];
    clear(): void;
  };
  /** The values the person chose for the settings the plugin declared; they follow the account. */
  settings: {
    get(key: string): SettingValue | undefined;
    all(): Record<string, SettingValue>;
    onChange(handler: (values: Record<string, SettingValue>) => void): () => void;
  };
  /**
   * The app's own state containers, for what the API above does not cover.
   * Not part of the API: they change between releases without notice, and a
   * plugin that uses them may break with any update.
   */
  unsupported: { stores: Record<string, unknown> };
}

/** What a plugin module exports: `export default { name, start(api) { … } }`. */
export interface NexaPlugin {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  settings?: PluginSetting[];
  start(api: NexaPluginApi): void | Promise<void>;
  stop?(): void | Promise<void>;
}
