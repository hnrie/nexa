/**
 * Nexa's staff ranks, as the server keeps them (internal/api/staff.go): each
 * holds everything the ones below it hold.
 *
 * - Mod: the panel's people, cases and log, and mutes and bans of at most a
 *   week. A mod lifts, closes and reopens only the cases they opened.
 * - Admin: the rest of the panel, but not disabling sign-in or deleting
 *   accounts, and no rights in other people's servers.
 * - Developer: what Nexa admins have always had (flag 1), every right in every
 *   server they are in, disabling sign-in, deleting, the instance's settings.
 * - Owner: the oldest Developer, the only one who gives and takes ranks.
 *
 * A rank is a public flag bit, so it is read from anyone's flags.
 */
import { CodeXml, Crown, Hammer, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { isOwner, useOwnerId } from "@/lib/owner";
import { t } from "@/i18n";

export type StaffRank = "owner" | "developer" | "admin" | "mod";
/** The ranks the owner can give, from the most to the least. */
export type GrantableRank = Exclude<StaffRank, "owner">;

export const FLAG_DEVELOPER = 1;
export const FLAG_STAFF_ADMIN = 256;
export const FLAG_STAFF_MOD = 512;
export const STAFF_FLAGS = FLAG_DEVELOPER | FLAG_STAFF_ADMIN | FLAG_STAFF_MOD;

const ORDER: StaffRank[] = ["mod", "admin", "developer", "owner"];

/** The longest mute or ban a mod can give. */
export const MOD_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Someone's rank from their flags, null for none. The owner's account always reads as the owner. */
export function rankOf(userId: string | null | undefined, flags: number | undefined, ownerId?: string): StaffRank | null {
  const f = flags ?? 0;
  if (userId && (ownerId ? userId === ownerId : isOwner(userId))) return "owner";
  if (f & FLAG_DEVELOPER) return "developer";
  if (f & FLAG_STAFF_ADMIN) return "admin";
  if (f & FLAG_STAFF_MOD) return "mod";
  return null;
}

/** Someone's rank from what this device knows of their account, for lists that are not reactive to it. */
export function staffRankOf(userId: string): StaffRank | null {
  const me = useAuth.getState().me;
  return rankOf(userId, me?.id === userId ? me.flags : useUsers.getState().byId[userId]?.flags);
}

/** Whether a rank is need or above it. */
export function atLeast(rank: StaffRank | null, need: StaffRank): boolean {
  return rank !== null && ORDER.indexOf(rank) >= ORDER.indexOf(need);
}

/** The signed-in account's rank. */
export function useMyRank(): StaffRank | null {
  const owner = useOwnerId();
  return useAuth((a) => rankOf(a.me?.id, a.me?.flags, owner));
}

export const RANK_ICON: Record<StaffRank, LucideIcon> = { owner: Crown, developer: CodeXml, admin: Hammer, mod: ShieldCheck };

export function rankName(rank: StaffRank): string {
  switch (rank) {
    case "owner":
      return t("profile.profileCard.owner");
    case "developer":
      return t("staff.rank.developer");
    case "admin":
      return t("profile.profileCard.admin");
    default:
      return t("staff.rank.mod");
  }
}

/** What the badge says when pointed at: "Owner of Nexa". */
export function rankTip(rank: StaffRank): string {
  switch (rank) {
    case "owner":
      return t("profile.profileCard.ownerTip");
    case "developer":
      return t("staff.rank.developerTip");
    case "admin":
      return t("profile.profileCard.adminTip");
    default:
      return t("staff.rank.modTip");
  }
}

/** What each rank the owner gives can do, in a line. */
export function rankPowers(rank: GrantableRank): string {
  switch (rank) {
    case "developer":
      return t("staff.rank.developerPowers");
    case "admin":
      return t("staff.rank.adminPowers");
    default:
      return t("staff.rank.modPowers");
  }
}
