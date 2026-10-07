import { t } from "@/i18n";

const KAOMOJI: Record<string, string> = {
  // markdown eats one backslash as an escape and would read the arm's _ as emphasis, so both are escaped
  shrug: "¯\\\\\\_(ツ)_/¯",
  tableflip: "(╯°□°)╯︵ ┻━┻",
  unflip: "┬─┬ ノ( ゜-゜ノ)",
  lenny: "( ͡° ͜ʖ ͡°)",
};

/**
 * Commands plugins add (lib/look/plugins). They come after the app's own,
 * which a plugin cannot replace, and each says which plugin it is from.
 */
export interface PluginCommand {
  name: string;
  desc: string;
  /** Runs the command; resolves to the message to send, or null to send none. */
  run: (args: string, channelId: string) => Promise<string | null>;
}
const pluginCommands = new Map<string, PluginCommand>();
const BUILT_IN = new Set(["shrug", "tableflip", "unflip", "lenny", "me", "spoiler"]);

/** Adds a plugin's command; false when the name is taken. */
export function registerPluginCommand(c: PluginCommand): boolean {
  const name = c.name.toLowerCase();
  if (BUILT_IN.has(name) || pluginCommands.has(name)) return false;
  pluginCommands.set(name, { ...c, name });
  return true;
}

/** Whether a name is one of the app's own commands, which no plugin can take. */
export function isBuiltInCommand(name: string): boolean {
  return BUILT_IN.has(name.toLowerCase());
}

/**
 * Adds a v2 plugin's command, taking over the name from any plugin that had
 * it (that plugin does not get it back when this one stops). Throws for one
 * of the app's own names.
 */
export function takePluginCommand(c: PluginCommand): void {
  const name = c.name.toLowerCase();
  if (BUILT_IN.has(name)) throw new Error(`/${name} is one of the app's own commands`);
  pluginCommands.set(name, { ...c, name });
}

export function unregisterPluginCommand(name: string, run: PluginCommand["run"]): void {
  if (pluginCommands.get(name.toLowerCase())?.run === run) pluginCommands.delete(name.toLowerCase());
}

export function commands() {
  return [
  { name: "shrug", desc: t("composer.commands.appendsShrug") },
  { name: "tableflip", desc: t("composer.commands.appendsToYourMessage") },
  { name: "unflip", desc: t("composer.commands.appendsToYourMessage2") },
  { name: "lenny", desc: t("composer.commands.appendsToYourMessage3") },
  { name: "me", desc: t("composer.commands.displaysTextWithEmphasis") },
  { name: "spoiler", desc: t("composer.commands.marksYourMessageAsASpoiler") },
  ...[...pluginCommands.values()].map((c) => ({ name: c.name, desc: c.desc })),
];
}

/**
 * What a message that starts with a slash means.
 *
 * - `text`: not a command at all (a path like /usr/bin, or no slash), sent as typed;
 * - `command`: one of the app's commands, and what it becomes;
 * - `unknown`: looks like a command the app does not have (/ban alice);
 * - `empty`: /me or /spoiler with nothing after it.
 *
 * The last two used to be published as they were typed, so "/ban someone"
 * landed in the channel for everyone to read.
 */
export type CommandResult = { kind: "text" } | { kind: "command"; text: string } | { kind: "unknown"; name: string } | { kind: "empty"; name: string } | { kind: "plugin"; name: string; run: (channelId: string) => Promise<string | null> };

export function runCommand(text: string): CommandResult {
  // names a plugin can give: letters, digits, - and _
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return { kind: "text" };
  const cmd = m[1]!.toLowerCase();
  const rest = (m[2] ?? "").trim();
  const k = KAOMOJI[cmd];
  if (k) return { kind: "command", text: rest ? `${rest} ${k}` : k };
  if (cmd === "me") return rest ? { kind: "command", text: `*${rest}*` } : { kind: "empty", name: cmd };
  if (cmd === "spoiler") return rest ? { kind: "command", text: `||${rest}||` } : { kind: "empty", name: cmd };
  const fromPlugin = pluginCommands.get(cmd);
  if (fromPlugin) return { kind: "plugin", name: cmd, run: (channelId) => fromPlugin.run(rest, channelId) };
  return { kind: "unknown", name: m[1]! };
}

/** Expands a leading slash command; returns null when the text is not one this app has. */
export function applyCommand(text: string): string | null {
  const r = runCommand(text);
  return r.kind === "command" ? r.text : null;
}
