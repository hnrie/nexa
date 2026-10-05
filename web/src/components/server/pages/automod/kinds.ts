import { AtSign, CaseUpper, FileWarning, Fish, IdCard, Link2Off, MailWarning, MessageSquareWarning, SmilePlus, SpellCheck, TicketX, Zap, type LucideIcon } from "lucide-react";
import type { AutomodAction, AutomodConfig, AutomodKind, AutomodRule } from "@/api/types";
import { t } from "@/i18n";
import { formatShortDuration } from "@/lib/time";

/** What a kind of rule is, in the order they are offered. */
export interface KindInfo {
  kind: AutomodKind;
  icon: LucideIcon;
  /** The server reads it itself rather than members' apps. */
  server: boolean;
  /** It looks at what people write, so Try It works for it. */
  tryable: boolean;
  defaults: () => { name: string; config: AutomodConfig; actions: AutomodAction[] };
}

export const KINDS: KindInfo[] = [
  { kind: "flagged_words", icon: MessageSquareWarning, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.flagged_words"), config: { lists: ["profanity", "slurs", "sexual"], evasion: true }, actions: [{ type: "block" }] }) },
  { kind: "words", icon: SpellCheck, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.words"), config: { words: [], regex: [], allow: [], evasion: true }, actions: [{ type: "block" }] }) },
  { kind: "spam", icon: Fish, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.spam"), config: { scams: true, shady_links: true, repeats: true, zalgo: true, walls: false }, actions: [{ type: "block" }] }) },
  { kind: "links", icon: Link2Off, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.links"), config: { mode: "all", allow: [] }, actions: [{ type: "block" }] }) },
  { kind: "invites", icon: TicketX, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.invites"), config: {}, actions: [{ type: "block" }] }) },
  { kind: "personal", icon: MailWarning, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.personal"), config: { emails: true, phones: true, ips: true, cards: true }, actions: [{ type: "block" }] }) },
  { kind: "caps", icon: CaseUpper, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.caps"), config: { percent: 70, min_length: 10 }, actions: [{ type: "block" }] }) },
  { kind: "emoji_spam", icon: SmilePlus, server: false, tryable: true, defaults: () => ({ name: t("automod.kind.emoji_spam"), config: { max: 10 }, actions: [{ type: "block" }] }) },
  { kind: "attachments", icon: FileWarning, server: false, tryable: false, defaults: () => ({ name: t("automod.kind.attachments"), config: { extensions: ["exe", "scr", "bat", "cmd", "msi", "vbs", "js", "ps1", "jar", "apk", "lnk", "hta"] }, actions: [{ type: "block" }] }) },
  { kind: "mentions", icon: AtSign, server: true, tryable: false, defaults: () => ({ name: t("automod.kind.mentions"), config: { max: 5, raid: true }, actions: [{ type: "block" }] }) },
  { kind: "flood", icon: Zap, server: true, tryable: false, defaults: () => ({ name: t("automod.kind.flood"), config: { messages: 5, seconds: 5 }, actions: [{ type: "block" }] }) },
  { kind: "profile", icon: IdCard, server: true, tryable: true, defaults: () => ({ name: t("automod.kind.profile"), config: { lists: ["slurs", "sexual"], words: [], names: true, bio: true, evasion: true }, actions: [{ type: "quarantine" }] }) },
];

export function kindInfo(kind: string): KindInfo | undefined {
  return KINDS.find((k) => k.kind === kind);
}

/** The ready-made lists, by name, as they are offered. */
export const LISTS = ["profanity", "slurs", "sexual"] as const;

export function listLabel(name: string): string {
  return t(`automod.list.${name}`);
}

/** How long, said the way the timeout menu says it. */
export const TIMEOUTS = [60, 300, 600, 3600, 86400, 604800];

function count(list: readonly unknown[] | undefined): number {
  return list?.length ?? 0;
}

/** A list of words joined into a line starts with a capital, in the languages that have them. */
function capitalized(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

/** What a rule looks for, in one line. */
export function ruleSummary(rule: Pick<AutomodRule, "kind" | "config">): string {
  const c = rule.config;
  switch (rule.kind) {
    case "flagged_words": {
      const lists = (c.lists ?? []).map(listLabel).join(", ");
      return count(c.allow) ? t("automod.summary.flaggedAllow", { lists, count: count(c.allow) }) : t("automod.summary.flagged", { lists });
    }
    case "words": {
      const words = count(c.words) ? t("automod.summary.wordsCount", { count: count(c.words) }) : "";
      const patterns = count(c.regex) ? t("automod.summary.patternsCount", { count: count(c.regex) }) : "";
      if (words && patterns) return t("automod.summary.wordsAndPatterns", { words, patterns });
      return capitalized(words || patterns) || t("automod.summary.noWords");
    }
    case "spam": {
      const signs = [c.scams && t("automod.spam.scams"), c.shady_links && t("automod.spam.shady"), c.repeats && t("automod.spam.repeats"), c.zalgo && t("automod.spam.zalgo"), c.walls && t("automod.spam.walls")].filter(Boolean);
      return capitalized(signs.join(", "));
    }
    case "links":
      return c.mode === "list" ? t("automod.summary.linksList", { count: count(c.domains) }) : count(c.allow) ? t("automod.summary.linksAllBut", { count: count(c.allow) }) : t("automod.summary.linksAll");
    case "invites":
      return t("automod.summary.invites");
    case "personal": {
      const kinds = [c.emails && t("automod.personal.emails"), c.phones && t("automod.personal.phones"), c.ips && t("automod.personal.ips"), c.cards && t("automod.personal.cards")].filter(Boolean);
      return capitalized(kinds.join(", "));
    }
    case "caps":
      return t("automod.summary.caps", { percent: c.percent ?? 70, length: c.min_length ?? 10 });
    case "emoji_spam":
      return t("automod.summary.emoji", { count: c.max ?? 10 });
    case "attachments":
      return (c.extensions ?? []).slice(0, 8).map((e) => `.${e}`).join(" ") + (count(c.extensions) > 8 ? ` +${count(c.extensions) - 8}` : "");
    case "mentions":
      return c.raid ? t("automod.summary.mentionsRaid", { count: c.max ?? 5 }) : t("automod.summary.mentions", { count: c.max ?? 5 });
    case "flood":
      return t("automod.summary.flood", { count: c.messages ?? 5, seconds: c.seconds ?? 5 });
    case "profile": {
      const parts = [c.names !== false && t("automod.profile.names"), c.bio && t("automod.profile.bio")].filter(Boolean).join(", ");
      return t("automod.summary.profile", { parts });
    }
  }
  return "";
}

/** What a rule does, each in a word or two. */
export function actionLabels(actions: AutomodAction[], channelName: (id: string) => string): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.type === "block") out.push(t("automod.do.block"));
    else if (a.type === "alert") out.push(t("automod.do.alertIn", { channel: a.channel_id ? channelName(a.channel_id) : "?" }));
    else if (a.type === "timeout") out.push((a.after ?? 1) > 1 ? t("automod.do.timeoutAfter", { time: formatShortDuration(a.seconds ?? 60), count: a.after ?? 1 }) : t("automod.do.timeout", { time: formatShortDuration(a.seconds ?? 60) }));
    else if (a.type === "quarantine") out.push(t("automod.do.quarantine"));
  }
  return out;
}

/** Words typed one to a line (or with commas between), as a rule keeps them. */
export function splitWords(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Patterns, one to a line: commas belong to the pattern. */
export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Whether a pattern is one this app can read (the server checks it further). */
export function patternProblem(p: string): string | null {
  try {
    new RegExp(p, "iu");
  } catch {
    return t("automod.editor.badPattern", { pattern: p });
  }
  if (/\(\?[=!<]/.test(p)) return t("automod.editor.noLookaround", { pattern: p });
  if (/\\[1-9]/.test(p)) return t("automod.editor.noBackref", { pattern: p });
  return null;
}
