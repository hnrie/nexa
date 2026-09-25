import { t } from "@/i18n";

const KAOMOJI: Record<string, string> = {
  // markdown eats one backslash as an escape and would read the arm's _ as emphasis, so both are escaped
  shrug: "¯\\\\\\_(ツ)_/¯",
  tableflip: "(╯°□°)╯︵ ┻━┻",
  unflip: "┬─┬ ノ( ゜-゜ノ)",
  lenny: "( ͡° ͜ʖ ͡°)",
};

export function commands() {
  return [
  { name: "shrug", desc: t("composer.commands.appendsShrug") },
  { name: "tableflip", desc: t("composer.commands.appendsToYourMessage") },
  { name: "unflip", desc: t("composer.commands.appendsToYourMessage2") },
  { name: "lenny", desc: t("composer.commands.appendsToYourMessage3") },
  { name: "me", desc: t("composer.commands.displaysTextWithEmphasis") },
  { name: "spoiler", desc: t("composer.commands.marksYourMessageAsASpoiler") },
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
export type CommandResult = { kind: "text" } | { kind: "command"; text: string } | { kind: "unknown"; name: string } | { kind: "empty"; name: string };

export function runCommand(text: string): CommandResult {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return { kind: "text" };
  const cmd = m[1]!.toLowerCase();
  const rest = (m[2] ?? "").trim();
  const k = KAOMOJI[cmd];
  if (k) return { kind: "command", text: rest ? `${rest} ${k}` : k };
  if (cmd === "me") return rest ? { kind: "command", text: `*${rest}*` } : { kind: "empty", name: cmd };
  if (cmd === "spoiler") return rest ? { kind: "command", text: `||${rest}||` } : { kind: "empty", name: cmd };
  return { kind: "unknown", name: m[1]! };
}

/** Expands a leading slash command; returns null when the text is not one this app has. */
export function applyCommand(text: string): string | null {
  const r = runCommand(text);
  return r.kind === "command" ? r.text : null;
}
