/**
 * What's New: the major features of each update, shown once to every account
 * that was around before it (components/shell/WhatsNewDialog.tsx), and any
 * time from Settings, About.
 *
 * Every change that adds a major feature, redesigns something or changes
 * behaviour people will notice adds an item here (see CLAUDE.md). A release's
 * id is the day it is deployed, "2026-09-26", then "2026-09-26.2" for a second
 * one that day. Its keys are whatsNew.r20260926.<name>Title and ...Body: the
 * id without its dashes and dots.
 */
import { BadgeCheck, Bug, EyeOff, FolderPlus, Link, MessageSquareDashed, MessageSquarePlus, Palette, Pin, Puzzle, RefreshCw, Search, Shapes, ShieldCheck, Type, UserCheck, Users, type LucideIcon } from "lucide-react";

export interface WhatsNewItem {
  icon: LucideIcon;
  /** i18n keys. */
  title: string;
  body: string;
}

export interface Release {
  id: string;
  items: WhatsNewItem[];
}

/** Newest first. */
export const RELEASES: Release[] = [
  {
    id: "2026-09-26.2",
    items: [
      { icon: ShieldCheck, title: "whatsNew.r202609262.dmPrivacyTitle", body: "whatsNew.r202609262.dmPrivacyBody" },
      { icon: MessageSquareDashed, title: "whatsNew.r202609262.quietDMTitle", body: "whatsNew.r202609262.quietDMBody" },
    ],
  },
  {
    id: "2026-09-26",
    items: [
      { icon: Search, title: "whatsNew.r20260926.searchTitle", body: "whatsNew.r20260926.searchBody" },
      { icon: Type, title: "whatsNew.r20260926.formattingTitle", body: "whatsNew.r20260926.formattingBody" },
      { icon: Palette, title: "whatsNew.r20260926.themesTitle", body: "whatsNew.r20260926.themesBody" },
      { icon: FolderPlus, title: "whatsNew.r20260926.foldersTitle", body: "whatsNew.r20260926.foldersBody" },
      { icon: Pin, title: "whatsNew.r20260926.pinsTitle", body: "whatsNew.r20260926.pinsBody" },
      { icon: Users, title: "whatsNew.r20260926.dmGroupsTitle", body: "whatsNew.r20260926.dmGroupsBody" },
      { icon: Bug, title: "whatsNew.r20260926.bugsTitle", body: "whatsNew.r20260926.bugsBody" },
      { icon: Puzzle, title: "whatsNew.r20260926.extendTitle", body: "whatsNew.r20260926.extendBody" },
      { icon: Link, title: "whatsNew.r20260926.invitesTitle", body: "whatsNew.r20260926.invitesBody" },
      { icon: Shapes, title: "whatsNew.r20260926.channelIconsTitle", body: "whatsNew.r20260926.channelIconsBody" },
      { icon: EyeOff, title: "whatsNew.r20260926.blockTitle", body: "whatsNew.r20260926.blockBody" },
      { icon: UserCheck, title: "whatsNew.r20260926.friendsTitle", body: "whatsNew.r20260926.friendsBody" },
      { icon: MessageSquarePlus, title: "whatsNew.r20260926.soloGroupTitle", body: "whatsNew.r20260926.soloGroupBody" },
      { icon: BadgeCheck, title: "whatsNew.r20260926.nexaTitle", body: "whatsNew.r20260926.nexaBody" },
      { icon: RefreshCw, title: "whatsNew.r20260926.updatesTitle", body: "whatsNew.r20260926.updatesBody" },
    ],
  },
];

/**
 * The most releases the pop-up lists at once. Someone back after a long time
 * away reads about the newest; Settings, About has every one.
 */
export const MAX_SHOWN = 6;

const RELEASE_ID = /^(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?$/;

/** A release id as its day (UTC midnight) and its number that day, or null for anything else. */
export function parseRelease(id: string): { day: number; n: number } | null {
  const m = RELEASE_ID.exec(id);
  if (!m) return null;
  return { day: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])), n: m[4] ? Number(m[4]) : 1 };
}

/**
 * Orders two release ids, older first. An id this build does not know how to
 * read counts as older than every real one, so a stray value can never hide
 * a release.
 */
export function compareReleases(a: string, b: string): number {
  const x = parseRelease(a);
  const y = parseRelease(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  return x.day - y.day || x.n - y.n;
}

/** The later of two seen markers, so a device on an older build never moves it back. */
export function laterRelease(a: string | null, b: string | null): string | null {
  if (!a || !parseRelease(a)) return b && parseRelease(b) ? b : a;
  if (!b || !parseRelease(b)) return a;
  return compareReleases(a, b) >= 0 ? a : b;
}

/** When this build was made, from its id (a base-36 timestamp); Infinity where there is none. */
export function builtAt(): number {
  const id = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
  const at = parseInt(id, 36);
  return Number.isFinite(at) && at > 0 ? at : Infinity;
}

/**
 * The moment a release reached people: its day, or when this build was made
 * if that is earlier, since nobody can have had a release before it was
 * built. An account made after that never saw what came before and has
 * nothing to catch up on.
 */
export function releaseStart(id: string, built = builtAt()): number {
  const p = parseRelease(id);
  return Math.min(p ? p.day : -Infinity, built);
}

/**
 * The releases an account has not been shown, newest first: those after the
 * last one it saw, and only those that came out after it was made.
 */
export function unseenReleases(seen: string | null, accountCreated: number, releases: Release[] = RELEASES, built = builtAt()): Release[] {
  return releases.filter((r) => (seen === null || compareReleases(r.id, seen) > 0) && accountCreated < releaseStart(r.id, built)).slice(0, MAX_SHOWN);
}

/** A release's day, written the way the reader's language writes a date. */
export function releaseDate(id: string, locale: string): string {
  const p = parseRelease(id);
  if (!p) return id;
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(p.day);
  } catch {
    return id.slice(0, 10);
  }
}
