import type { AppCommand, CommandChoice, CommandOption } from "@/api/apps";
import { translator } from "@/i18n";

/**
 * Small things the app's views of apps share: the language an app is told
 * someone uses, names in that language, and the words for option types.
 */

/**
 * The language someone uses, as bot libraries name languages (an app picks its
 * replies by it). Nexa's own tags, with the regional ones those libraries use
 * where they differ; Arabic has none there and goes as it is.
 */
export function protocolLocale(tag: string = translator().locale): string {
  switch (tag) {
    case "en":
      return "en-US";
    case "es":
      return "es-ES";
    case "sv":
      return "sv-SE";
    default:
      return tag;
  }
}

/** A name or description in the reader's language, where the app gave one. */
export function localized(base: string, map: Record<string, string> | undefined, tag: string = translator().locale): string {
  if (!map) return base;
  return map[protocolLocale(tag)] ?? map[tag] ?? (tag === "en" ? map["en-GB"] : tag === "es" ? map["es-419"] : undefined) ?? base;
}

export const commandName = (c: Pick<AppCommand, "name" | "name_localizations">): string => localized(c.name, c.name_localizations);
export const commandDescription = (c: Pick<AppCommand, "description" | "description_localizations">): string => localized(c.description, c.description_localizations);
export const optionName = (o: Pick<CommandOption, "name" | "name_localizations">): string => localized(o.name, o.name_localizations);
export const optionDescription = (o: Pick<CommandOption, "description" | "description_localizations">): string => localized(o.description, o.description_localizations);
export const choiceName = (c: CommandChoice): string => localized(c.name, c.name_localizations);

// Option types, at the protocol's numbers.
export const OPT_SUBCOMMAND = 1;
export const OPT_GROUP = 2;
export const OPT_STRING = 3;
export const OPT_INTEGER = 4;
export const OPT_BOOLEAN = 5;
export const OPT_USER = 6;
export const OPT_CHANNEL = 7;
export const OPT_ROLE = 8;
export const OPT_MENTIONABLE = 9;
export const OPT_NUMBER = 10;
export const OPT_ATTACHMENT = 11;

/**
 * The commands a slash command really is: itself, or each of its
 * subcommands, and of its groups' subcommands, by their full name ("config
 * set"), with the options that one takes.
 */
export interface CommandLeaf {
  command: AppCommand;
  /** The subcommand path under the command: [] for the command itself, ["set"] or ["config", "set"]. */
  path: string[];
  /** The full name to show, in the reader's language. */
  label: string;
  description: string;
  options: CommandOption[];
}

export function commandLeaves(command: AppCommand): CommandLeaf[] {
  const top = commandName(command);
  const subs = (command.options ?? []).filter((o) => o.type === OPT_SUBCOMMAND || o.type === OPT_GROUP);
  if (!subs.length) return [{ command, path: [], label: top, description: commandDescription(command), options: command.options ?? [] }];
  const out: CommandLeaf[] = [];
  for (const o of subs) {
    if (o.type === OPT_SUBCOMMAND) {
      out.push({ command, path: [o.name], label: `${top} ${optionName(o)}`, description: optionDescription(o), options: o.options ?? [] });
      continue;
    }
    for (const sub of o.options ?? []) {
      if (sub.type !== OPT_SUBCOMMAND) continue;
      out.push({ command, path: [o.name, sub.name], label: `${top} ${optionName(o)} ${optionName(sub)}`, description: optionDescription(sub), options: sub.options ?? [] });
    }
  }
  return out;
}

/** An option's value as the server takes it, nested under the subcommand path. */
export function nestOptions(path: readonly string[], options: { name: string; value: unknown; focused?: boolean }[]): unknown[] {
  let list: unknown[] = options.map((o) => ({ name: o.name, value: o.value, ...(o.focused ? { focused: true } : {}) }));
  for (let i = path.length - 1; i >= 0; i--) list = [{ name: path[i], options: list }];
  return list;
}
