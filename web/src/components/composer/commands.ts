
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

/** Expands a leading slash command; returns null when the text is not a command. */
export function applyCommand(text: string): string | null {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const cmd = m[1]!.toLowerCase();
  const rest = (m[2] ?? "").trim();
  const k = KAOMOJI[cmd];
  if (k) return rest ? `${rest} ${k}` : k;
  if (cmd === "me") return rest ? `*${rest}*` : null;
  if (cmd === "spoiler") return rest ? `||${rest}||` : null;
  return null;
}
