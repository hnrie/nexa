const KAOMOJI: Record<string, string> = {
  shrug: "¯\\_(ツ)_/¯",
  tableflip: "(╯°□°)╯︵ ┻━┻",
  unflip: "┬─┬ ノ( ゜-゜ノ)",
  lenny: "( ͡° ͜ʖ ͡°)",
};

export const COMMANDS = [
  { name: "shrug", desc: "Appends ¯\\_(ツ)_/¯ to your message." },
  { name: "tableflip", desc: "Appends (╯°□°)╯︵ ┻━┻ to your message." },
  { name: "unflip", desc: "Appends ┬─┬ ノ( ゜-゜ノ) to your message." },
  { name: "lenny", desc: "Appends ( ͡° ͜ʖ ͡°) to your message." },
  { name: "me", desc: "Displays text with emphasis." },
  { name: "spoiler", desc: "Marks your message as a spoiler." },
];

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
