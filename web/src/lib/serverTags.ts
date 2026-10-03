/**
 * Server tags: a few letters, a badge and a colour a server's admins choose,
 * worn by its members next to their name everywhere (internal/api/
 * server_tags.go). The badge is one every server has, drawn from these
 * icons, or a picture of the server's own, cut on the server and kept moving
 * when it moves.
 */
import { Bird, Cat, Cherry, Cloud, Coffee, Crown, Dog, Droplet, Fish, Flame, Gamepad2, Gem, Ghost, Heart, Leaf, Moon, Music, PawPrint, Rabbit, Rainbow, Rocket, Shield, Skull, Snowflake, Sparkles, Star, Sun, Swords, Trophy, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/api/client";
import type { ServerTag } from "@/api/types";
import { P } from "./perms";
import type { ServerState } from "@/stores/servers";
import { hasZalgo } from "@/lib/zalgo";

/** The badges every server can use, in the order the picker shows them; the names are the server's (tagIcons). */
export const TAG_ICONS: [string, LucideIcon][] = [
  ["leaf", Leaf], ["flame", Flame], ["heart", Heart], ["star", Star], ["sparkles", Sparkles], ["zap", Zap],
  ["moon", Moon], ["sun", Sun], ["snowflake", Snowflake], ["droplet", Droplet], ["cloud", Cloud], ["rainbow", Rainbow],
  ["skull", Skull], ["ghost", Ghost], ["crown", Crown], ["gem", Gem], ["swords", Swords], ["shield", Shield],
  ["cat", Cat], ["dog", Dog], ["bird", Bird], ["fish", Fish], ["rabbit", Rabbit], ["paw-print", PawPrint],
  ["rocket", Rocket], ["music", Music], ["gamepad-2", Gamepad2], ["trophy", Trophy], ["coffee", Coffee], ["cherry", Cherry],
];
const ICONS = new Map(TAG_ICONS);

/** What a new tag starts with. */
export const DEFAULT_TAG_BADGE = "icon:sparkles";

/** The icon a badge names, or null for a picture (or a badge from a newer app). */
export function tagIcon(badge: string): LucideIcon | null {
  return badge.startsWith("icon:") ? (ICONS.get(badge.slice(5)) ?? null) : null;
}

/** The address of a badge's picture at a size, or null for an icon. */
export function tagImageUrl(badge: string, css: number): string | null {
  const m = /^image:(\d{1,20})$/.exec(badge);
  if (!m) return null;
  const density = typeof window !== "undefined" ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 1;
  let size = 16;
  while (size < css * density && size < 128) size *= 2;
  return `${api.baseUrl}/media/tag/${m[1]}?size=${size}`;
}

/** The colour a tag is drawn in: its own, or the accent. */
export function tagColorCss(color: number | null | undefined): string {
  return typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : "var(--brand)";
}

const SYMBOLS = "!?.-_+&#@$%*~^=:'";

/**
 * A tag's letters as the server will take them (cleanTagText): one to four
 * letters or digits in any script, with the marks that belong to them, or a
 * few symbols, and no spaces. `count` is how many it has.
 */
/** A tag's most letters (internal/api/server_tags.go maxTagLetters): what still sits beside a name on a phone. */
export const MAX_TAG_LETTERS = 8;

export function readTagText(raw: string): { text: string; count: number; ok: boolean } {
  const text = raw.trim();
  let count = 0;
  for (const ch of text) {
    if (/\p{L}|\p{N}/u.test(ch)) count++;
    else if (/\p{Mn}|\p{Mc}/u.test(ch)) {
      if (count === 0) return { text, count, ok: false };
    } else if (SYMBOLS.includes(ch)) count++;
    else return { text, count, ok: false };
  }
  return { text, count, ok: count >= 1 && count <= MAX_TAG_LETTERS && [...text].length <= MAX_TAG_LETTERS * 4 && !hasZalgo(text) };
}

/** Whether the account may wear this server's tag: in it, and holding one of the roles when it is kept to some. */
export function canWearTag(st: ServerState | undefined): boolean {
  const tag: ServerTag | null | undefined = st?.server.tag;
  if (!st || !tag) return false;
  if (!tag.limited) return true;
  if ((st.myPermissions & P.MANAGE_SERVER) !== 0n) return true;
  return st.me.role_ids.some((r) => tag.roles.includes(r));
}
