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
import { AudioLines, BadgeCheck, BellRing, Bug, CircleX, Clapperboard, ClipboardCopy, CloudUpload, Eye, EyeOff, FolderPlus, Gamepad2, Globe, Headphones, House, IdCard, ImagePlus, Images, Keyboard, LayoutGrid, Link, MapPinOff, MessageCircleMore, MessageSquareDashed, MessageSquarePlus, MessagesSquare, MousePointerClick, Music, Newspaper, NotebookPen, Paintbrush, Palette, PanelBottom, PanelsTopLeft, Pin, Play, Puzzle, RefreshCw, RemoveFormatting, Reply, Search, SendHorizontal, ServerCog, Shapes, ShieldCheck, SlidersHorizontal, Smartphone, Smile, Sparkles, SpellCheck, Sticker, StickyNote, Tag, TvMinimalPlay, Type, UserCheck, UserCog, UserPen, Users, UsersRound, Vote, Webhook, type LucideIcon } from "lucide-react";

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
    id: "2026-10-02.8",
    items: [
      { icon: Link, title: "whatsNew.r202610028.linksTitle", body: "whatsNew.r202610028.linksBody" },
      { icon: Smartphone, title: "whatsNew.r202610028.androidTitle", body: "whatsNew.r202610028.androidBody" },
      { icon: Reply, title: "whatsNew.r202610028.swipeTitle", body: "whatsNew.r202610028.swipeBody" },
    ],
  },
  {
    id: "2026-10-02.7",
    items: [{ icon: Play, title: "whatsNew.r202610027.previewsTitle", body: "whatsNew.r202610027.previewsBody" }],
  },
  {
    id: "2026-10-02.6",
    items: [{ icon: Music, title: "whatsNew.r202610026.musicTitle", body: "whatsNew.r202610026.musicBody" }],
  },
  {
    id: "2026-10-02.5",
    items: [
      { icon: MousePointerClick, title: "whatsNew.r202610025.popoutTitle", body: "whatsNew.r202610025.popoutBody" },
      { icon: UserCog, title: "whatsNew.r202610025.rolesTitle", body: "whatsNew.r202610025.rolesBody" },
    ],
  },
  {
    id: "2026-10-02.4",
    items: [
      { icon: Paintbrush, title: "whatsNew.r202610024.designerTitle", body: "whatsNew.r202610024.designerBody" },
      { icon: IdCard, title: "whatsNew.r202610024.cardTitle", body: "whatsNew.r202610024.cardBody" },
      { icon: ImagePlus, title: "whatsNew.r202610024.typingTitle", body: "whatsNew.r202610024.typingBody" },
      { icon: Tag, title: "whatsNew.r202610024.tagsTitle", body: "whatsNew.r202610024.tagsBody" },
      { icon: RemoveFormatting, title: "whatsNew.r202610024.zalgoTitle", body: "whatsNew.r202610024.zalgoBody" },
    ],
  },
  {
    id: "2026-10-02.3",
    items: [
      { icon: LayoutGrid, title: "whatsNew.r202610023.widgetsTitle", body: "whatsNew.r202610023.widgetsBody" },
      { icon: PanelsTopLeft, title: "whatsNew.r202610023.profileTitle", body: "whatsNew.r202610023.profileBody" },
      { icon: Tag, title: "whatsNew.r202610023.tagsTitle", body: "whatsNew.r202610023.tagsBody" },
      { icon: MessageCircleMore, title: "whatsNew.r202610023.typingTitle", body: "whatsNew.r202610023.typingBody" },
      { icon: Keyboard, title: "whatsNew.r202610023.keybindsTitle", body: "whatsNew.r202610023.keybindsBody" },
      { icon: Gamepad2, title: "whatsNew.r202610023.activityTitle", body: "whatsNew.r202610023.activityBody" },
      { icon: FolderPlus, title: "whatsNew.r202610023.railTitle", body: "whatsNew.r202610023.railBody" },
    ],
  },
  {
    id: "2026-10-02.2",
    items: [
      { icon: Clapperboard, title: "whatsNew.r202610022.streamTitle", body: "whatsNew.r202610022.streamBody" },
      { icon: BellRing, title: "whatsNew.r202610022.friendSoundTitle", body: "whatsNew.r202610022.friendSoundBody" },
    ],
  },
  {
    id: "2026-10-02",
    items: [
      { icon: AudioLines, title: "whatsNew.r20261002.noiseTitle", body: "whatsNew.r20261002.noiseBody" },
      { icon: SlidersHorizontal, title: "whatsNew.r20261002.sensitivityTitle", body: "whatsNew.r20261002.sensitivityBody" },
      { icon: Link, title: "whatsNew.r20261002.profileTitle", body: "whatsNew.r20261002.profileBody" },
      { icon: MessagesSquare, title: "whatsNew.r20261002.orderTitle", body: "whatsNew.r20261002.orderBody" },
      { icon: Sticker, title: "whatsNew.r20261002.expressionsTitle", body: "whatsNew.r20261002.expressionsBody" },
    ],
  },
  {
    id: "2026-10-01.2",
    items: [
      { icon: Globe, title: "whatsNew.r202610012.moveTitle", body: "whatsNew.r202610012.moveBody" },
      { icon: NotebookPen, title: "whatsNew.r202610012.notesTitle", body: "whatsNew.r202610012.notesBody" },
      { icon: AudioLines, title: "whatsNew.r202610012.soundsTitle", body: "whatsNew.r202610012.soundsBody" },
      { icon: PanelBottom, title: "whatsNew.r202610012.dockTitle", body: "whatsNew.r202610012.dockBody" },
    ],
  },
  {
    id: "2026-10-01",
    items: [
      { icon: TvMinimalPlay, title: "whatsNew.r20261001.youtubeTitle", body: "whatsNew.r20261001.youtubeBody" },
      { icon: CircleX, title: "whatsNew.r20261001.removeTitle", body: "whatsNew.r20261001.removeBody" },
      { icon: Smartphone, title: "whatsNew.r20261001.phoneTitle", body: "whatsNew.r20261001.phoneBody" },
      { icon: ImagePlus, title: "whatsNew.r20261001.casesTitle", body: "whatsNew.r20261001.casesBody" },
      { icon: ServerCog, title: "whatsNew.r20261001.serversTitle", body: "whatsNew.r20261001.serversBody" },
    ],
  },
  {
    id: "2026-09-30.3",
    items: [
      { icon: NotebookPen, title: "whatsNew.r202609303.notesTitle", body: "whatsNew.r202609303.notesBody" },
      { icon: UsersRound, title: "whatsNew.r202609303.liveTitle", body: "whatsNew.r202609303.liveBody" },
      { icon: Newspaper, title: "whatsNew.r202609303.postsTitle", body: "whatsNew.r202609303.postsBody" },
      { icon: Type, title: "whatsNew.r202609303.fontTitle", body: "whatsNew.r202609303.fontBody" },
      { icon: Search, title: "whatsNew.r202609303.settingsTitle", body: "whatsNew.r202609303.settingsBody" },
      { icon: MousePointerClick, title: "whatsNew.r202609303.pickTitle", body: "whatsNew.r202609303.pickBody" },
      { icon: Smartphone, title: "whatsNew.r202609303.phoneTitle", body: "whatsNew.r202609303.phoneBody" },
      { icon: BadgeCheck, title: "whatsNew.r202609303.rolesTitle", body: "whatsNew.r202609303.rolesBody" },
    ],
  },
  {
    id: "2026-09-30.2",
    items: [
      { icon: Images, title: "whatsNew.r202609302.picturesTitle", body: "whatsNew.r202609302.picturesBody" },
      { icon: CloudUpload, title: "whatsNew.r202609302.uploadsTitle", body: "whatsNew.r202609302.uploadsBody" },
    ],
  },
  {
    id: "2026-09-30",
    items: [
      { icon: Sparkles, title: "whatsNew.r20260930.lookTitle", body: "whatsNew.r20260930.lookBody" },
      { icon: IdCard, title: "whatsNew.r20260930.profilesTitle", body: "whatsNew.r20260930.profilesBody" },
      { icon: Music, title: "whatsNew.r20260930.spotifyTitle", body: "whatsNew.r20260930.spotifyBody" },
    ],
  },
  {
    id: "2026-09-29.2",
    items: [
      { icon: AudioLines, title: "whatsNew.r202609292.callsTitle", body: "whatsNew.r202609292.callsBody" },
      { icon: Sparkles, title: "whatsNew.r202609292.emojiTitle", body: "whatsNew.r202609292.emojiBody" },
      { icon: Pin, title: "whatsNew.r202609292.pinsTitle", body: "whatsNew.r202609292.pinsBody" },
      { icon: Palette, title: "whatsNew.r202609292.themesTitle", body: "whatsNew.r202609292.themesBody" },
    ],
  },
  {
    id: "2026-09-29",
    items: [
      { icon: Headphones, title: "whatsNew.r20260929.discordTitle", body: "whatsNew.r20260929.discordBody" },
      { icon: SlidersHorizontal, title: "whatsNew.r20260929.activityTitle", body: "whatsNew.r20260929.activityBody" },
      { icon: House, title: "whatsNew.r20260929.homeTitle", body: "whatsNew.r20260929.homeBody" },
      { icon: Smartphone, title: "whatsNew.r20260929.phoneTitle", body: "whatsNew.r20260929.phoneBody" },
    ],
  },
  {
    id: "2026-09-27.2",
    items: [
      { icon: PanelsTopLeft, title: "whatsNew.r202609272.layoutTitle", body: "whatsNew.r202609272.layoutBody" },
      { icon: MousePointerClick, title: "whatsNew.r202609272.textMenuTitle", body: "whatsNew.r202609272.textMenuBody" },
      { icon: SpellCheck, title: "whatsNew.r202609272.spellingTitle", body: "whatsNew.r202609272.spellingBody" },
      { icon: Smile, title: "whatsNew.r202609272.emojiTitle", body: "whatsNew.r202609272.emojiBody" },
      { icon: Keyboard, title: "whatsNew.r202609272.typingTitle", body: "whatsNew.r202609272.typingBody" },
      { icon: Reply, title: "whatsNew.r202609272.repliesTitle", body: "whatsNew.r202609272.repliesBody" },
      { icon: Eye, title: "whatsNew.r202609272.sendPreviewTitle", body: "whatsNew.r202609272.sendPreviewBody" },
      { icon: SendHorizontal, title: "whatsNew.r202609272.sendButtonTitle", body: "whatsNew.r202609272.sendButtonBody" },
      { icon: UserPen, title: "whatsNew.r202609272.aboutMeTitle", body: "whatsNew.r202609272.aboutMeBody" },
      { icon: LayoutGrid, title: "whatsNew.r202609272.gridTitle", body: "whatsNew.r202609272.gridBody" },
      { icon: ClipboardCopy, title: "whatsNew.r202609272.copyTitle", body: "whatsNew.r202609272.copyBody" },
      { icon: Newspaper, title: "whatsNew.r202609272.previewsTitle", body: "whatsNew.r202609272.previewsBody" },
    ],
  },
  {
    id: "2026-09-27",
    items: [
      { icon: Vote, title: "whatsNew.r20260927.pollsTitle", body: "whatsNew.r20260927.pollsBody" },
      { icon: UsersRound, title: "whatsNew.r20260927.groupsTitle", body: "whatsNew.r20260927.groupsBody" },
      { icon: StickyNote, title: "whatsNew.r20260927.notesTitle", body: "whatsNew.r20260927.notesBody" },
      { icon: MapPinOff, title: "whatsNew.r20260927.metadataTitle", body: "whatsNew.r20260927.metadataBody" },
    ],
  },
  {
    id: "2026-09-26.4",
    items: [{ icon: Webhook, title: "whatsNew.r202609264.webhooksTitle", body: "whatsNew.r202609264.webhooksBody" }],
  },
  {
    id: "2026-09-26.3",
    items: [{ icon: Sticker, title: "whatsNew.r202609263.stickersTitle", body: "whatsNew.r202609263.stickersBody" }],
  },
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
