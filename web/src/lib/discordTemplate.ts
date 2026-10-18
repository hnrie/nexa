const CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;

export type ParsedDiscordTemplate = { ok: true; code: string } | { ok: false; reason: "empty" | "invite" | "invalid" };

/**
 * Extracts a Discord server template code from a discord.new link, a
 * discord.com/template link, or a bare template code.
 */
export function parseDiscordTemplate(input: string): ParsedDiscordTemplate {
  const s = input.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (!s.includes("://") && !s.includes("/") && !s.includes(".")) {
    return CODE_RE.test(s) ? { ok: true, code: s } : { ok: false, reason: "invalid" };
  }
  const withScheme = s.includes("://") ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  let host = u.hostname.toLowerCase();
  for (const prefix of ["www.", "ptb.", "canary."]) {
    if (host.startsWith(prefix)) host = host.slice(prefix.length);
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "discord.gg") return { ok: false, reason: "invite" };
  if (host === "discord.new") {
    const code = parts[0];
    return parts.length === 1 && code && CODE_RE.test(code) ? { ok: true, code } : { ok: false, reason: "invalid" };
  }
  if (host === "discord.com" || host === "discordapp.com") {
    if (parts[0]?.toLowerCase() === "invite") return { ok: false, reason: "invite" };
    if (parts.length === 2 && (parts[0]?.toLowerCase() === "template" || parts[0]?.toLowerCase() === "templates") && parts[1] && CODE_RE.test(parts[1])) {
      return { ok: true, code: parts[1] };
    }
    if (parts.length === 4 && parts[0]?.toLowerCase() === "api" && parts[1]?.toLowerCase() === "guilds" && parts[2]?.toLowerCase() === "templates" && parts[3] && CODE_RE.test(parts[3])) {
      return { ok: true, code: parts[3] };
    }
    if (parts.length === 5 && parts[0]?.toLowerCase() === "api" && parts[2]?.toLowerCase() === "guilds" && parts[3]?.toLowerCase() === "templates" && parts[4] && CODE_RE.test(parts[4])) {
      return { ok: true, code: parts[4] };
    }
  }
  return { ok: false, reason: "invalid" };
}

/** Reports whether input is explicitly a Discord template URL (rather than a bare code). */
export function isDiscordTemplateUrl(input: string): boolean {
  const s = input.trim();
  if (!s.includes("/") && !s.includes(".")) return false;
  return parseDiscordTemplate(s).ok;
}
