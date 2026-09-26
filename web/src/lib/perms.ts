/**
 * Discord-compatible permission bitsets, mirroring internal/perms on the server.
 * Bits are BigInt because several sit above 2^32; the wire form is a decimal string.
 */
import type { Member, Overwrite, Role } from "@/api/types";

import { t } from "@/i18n";
export const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_SERVER: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS: 1n << 30n,
  MODERATE_MEMBERS: 1n << 40n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_POLLS: 1n << 49n,
} as const;

export type PermName = keyof typeof P;

export const ALL: bigint = Object.values(P).reduce((a, b) => a | b, 0n);
export const DEFAULT_EVERYONE: bigint =
  P.CREATE_INSTANT_INVITE | P.ADD_REACTIONS | P.STREAM | P.VIEW_CHANNEL | P.SEND_MESSAGES | P.EMBED_LINKS | P.ATTACH_FILES | P.READ_MESSAGE_HISTORY | P.CONNECT | P.SPEAK | P.USE_VAD | P.CHANGE_NICKNAME | P.USE_SOUNDBOARD | P.CREATE_POLLS;
export const TIMED_OUT_KEEP: bigint = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;

/** Permissions shown in the role and channel editors, grouped as Discord groups them. */
export function permGroups(): { group: string; items: { name: PermName; label: string; description: string; channel?: ("text" | "voice")[] }[] }[] {
  return [
  {
    group: t("perms.generalServerPermissions"),
    items: [
      { name: "VIEW_CHANNEL", label: t("perms.viewChannels"), description: t("perms.allowsMembersToViewChannelsBy"), channel: ["text", "voice"] },
      { name: "MANAGE_CHANNELS", label: t("perms.manageChannels"), description: t("perms.allowsMembersToCreateEditOr"), channel: ["text", "voice"] },
      { name: "MANAGE_ROLES", label: t("perms.manageRoles"), description: t("perms.allowsMembersToCreateNewRoles"), channel: ["text", "voice"] },
      { name: "MANAGE_EMOJIS", label: t("perms.manageExpressions"), description: t("perms.allowsMembersToAddOrRemove") },
      { name: "MANAGE_WEBHOOKS", label: t("perms.manageWebhooks"), description: t("perms.manageWebhooksDescription"), channel: ["text"] },
      { name: "VIEW_AUDIT_LOG", label: t("perms.viewAuditLog"), description: t("perms.allowsMembersToViewARecord") },
      { name: "MANAGE_SERVER", label: t("perms.manageServer"), description: t("perms.allowsMembersToChangeThisServer") },
    ],
  },
  {
    group: t("perms.membershipPermissions"),
    items: [
      { name: "CREATE_INSTANT_INVITE", label: t("server.invites.createInvite"), description: t("perms.allowsMembersToInviteNewPeople"), channel: ["text", "voice"] },
      { name: "CHANGE_NICKNAME", label: t("perms.changeNickname"), description: t("perms.allowsMembersToChangeTheirOwn") },
      { name: "MANAGE_NICKNAMES", label: t("perms.manageNicknames"), description: t("perms.allowsMembersToChangeTheNicknames") },
      { name: "KICK_MEMBERS", label: t("perms.kickMembers"), description: t("perms.allowsMembersToRemoveOtherMembers") },
      { name: "BAN_MEMBERS", label: t("perms.banMembers"), description: t("perms.allowsMembersToPermanentlyBanOther") },
      { name: "MODERATE_MEMBERS", label: t("perms.timeOutMembers"), description: t("perms.membersWithThisPermissionCanTime") },
    ],
  },
  {
    group: t("perms.textChannelPermissions"),
    items: [
      { name: "SEND_MESSAGES", label: t("perms.sendMessages"), description: t("perms.allowsMembersToSendMessagesIn"), channel: ["text"] },
      { name: "EMBED_LINKS", label: t("perms.embedLinks"), description: t("perms.allowsLinksThatMembersShareTo"), channel: ["text"] },
      { name: "ATTACH_FILES", label: t("perms.attachFiles"), description: t("perms.allowsMembersToUploadFilesOr"), channel: ["text"] },
      { name: "ADD_REACTIONS", label: t("perms.addReactions"), description: t("perms.allowsMembersToAddNewEmoji"), channel: ["text"] },
      { name: "MENTION_EVERYONE", label: t("perms.mentionEveryoneAndAllRoles"), description: t("perms.allowsMembersToUseEveryoneAnd"), channel: ["text"] },
      { name: "MANAGE_MESSAGES", label: t("perms.manageMessages"), description: t("perms.allowsMembersToDeleteMessagesBy"), channel: ["text"] },
      { name: "READ_MESSAGE_HISTORY", label: t("perms.readMessageHistory"), description: t("perms.allowsMembersToReadPreviousMessages"), channel: ["text"] },
      { name: "CREATE_POLLS", label: t("perms.createPolls"), description: t("perms.allowsMembersToCreatePolls"), channel: ["text"] },
    ],
  },
  {
    group: t("perms.voiceChannelPermissions"),
    items: [
      { name: "CONNECT", label: t("perms.connect"), description: t("perms.allowsMembersToJoinVoiceChannels"), channel: ["voice"] },
      { name: "SPEAK", label: t("perms.speak"), description: t("perms.allowsMembersToTalkInVoice"), channel: ["voice"] },
      { name: "STREAM", label: t("perms.video"), description: t("perms.allowsMembersToShareTheirVideo"), channel: ["voice"] },
      { name: "USE_SOUNDBOARD", label: t("perms.useSoundboard"), description: t("perms.allowsMembersToSendSoundsFrom"), channel: ["voice"] },
      { name: "USE_VAD", label: t("perms.useVoiceActivity"), description: t("perms.allowsMembersToSpeakInVoice"), channel: ["voice"] },
      { name: "PRIORITY_SPEAKER", label: t("perms.prioritySpeaker"), description: t("perms.allowsMembersToBeMoreEasily"), channel: ["voice"] },
      { name: "MUTE_MEMBERS", label: t("perms.muteMembers"), description: t("perms.allowsMembersToMuteOtherMembers"), channel: ["voice"] },
      { name: "DEAFEN_MEMBERS", label: t("perms.deafenMembers"), description: t("perms.allowsMembersToDeafenOtherMembers"), channel: ["voice"] },
      { name: "MOVE_MEMBERS", label: t("perms.moveMembers"), description: t("perms.allowsMembersToMoveOtherMembers"), channel: ["voice"] },
    ],
  },
  {
    group: t("perms.advancedPermissions"),
    items: [{ name: "ADMINISTRATOR", label: t("perms.administrator"), description: t("perms.membersWithThisPermissionHaveEvery") }],
  },
];
}

export function parsePerm(s: string | bigint | number | null | undefined): bigint {
  if (typeof s === "bigint") return s;
  if (typeof s === "number") return BigInt(s);
  if (!s) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

export function permString(p: bigint): string {
  return p.toString(10);
}

export function has(p: bigint, need: bigint): boolean {
  return (p & need) === need;
}

export interface PermRole {
  id: string;
  position: number;
  permissions: bigint;
}

export interface PermMember {
  userId: string;
  roleIds: string[];
  timedOut: boolean;
}

export function toPermRoles(roles: Iterable<Role>): PermRole[] {
  const out: PermRole[] = [];
  for (const r of roles) out.push({ id: r.id, position: r.position, permissions: parsePerm(r.permissions) });
  return out;
}

export function toPermMember(m: Member | undefined, userId: string, now = Date.now()): PermMember {
  return { userId, roleIds: m?.role_ids ?? [], timedOut: !!m?.timeout_until && m.timeout_until > now };
}

/** Server-level permissions: @everyone OR the member's roles; Administrator and ownership grant everything. */
export function base(everyoneId: string, roles: PermRole[], m: PermMember, isOwner: boolean): bigint {
  if (isOwner) return ALL;
  const mine = new Set([everyoneId, ...m.roleIds]);
  let p = 0n;
  for (const r of roles) if (mine.has(r.id)) p |= r.permissions;
  if (has(p, P.ADMINISTRATOR)) return ALL;
  // as the server's Base does: a timeout takes everything but looking
  if (m.timedOut) p &= TIMED_OUT_KEEP;
  return p;
}

/** A member's permissions in a channel: base → @everyone overwrite → role overwrites → member overwrite → timeout → no view = nothing. */
export function compute(everyoneId: string, roles: PermRole[], m: PermMember, isOwner: boolean, overwrites: Overwrite[] | undefined): bigint {
  const b = base(everyoneId, roles, m, isOwner);
  if (isOwner || has(b, P.ADMINISTRATOR)) return ALL;
  let p = b;
  const mine = new Set(m.roleIds);
  let everyoneOW: Overwrite | undefined;
  let roleAllow = 0n;
  let roleDeny = 0n;
  let memberOW: Overwrite | undefined;
  for (const ow of overwrites ?? []) {
    if (ow.target_type === "role" && ow.target_id === everyoneId) everyoneOW = ow;
    else if (ow.target_type === "role" && mine.has(ow.target_id)) {
      roleAllow |= parsePerm(ow.allow);
      roleDeny |= parsePerm(ow.deny);
    } else if (ow.target_type === "member" && ow.target_id === m.userId) memberOW = ow;
  }
  if (everyoneOW) p = (p & ~parsePerm(everyoneOW.deny)) | parsePerm(everyoneOW.allow);
  p = (p & ~roleDeny) | roleAllow;
  if (memberOW) p = (p & ~parsePerm(memberOW.deny)) | parsePerm(memberOW.allow);
  if (m.timedOut) p &= TIMED_OUT_KEEP;
  if (!has(p, P.VIEW_CHANNEL)) return 0n;
  return p;
}

/** Position of the member's highest role (0 = only @everyone). */
export function highestPosition(roles: PermRole[], m: PermMember): number {
  let best = 0;
  for (const id of m.roleIds) for (const r of roles) if (r.id === id && r.position > best) best = r.position;
  return best;
}

export function canManageRole(actorHighest: number, actorIsOwner: boolean, rolePosition: number): boolean {
  return actorIsOwner || actorHighest > rolePosition;
}

export function canActOn(actorHighest: number, targetHighest: number, actorIsOwner: boolean, targetIsOwner: boolean): boolean {
  if (targetIsOwner) return false;
  return actorIsOwner || actorHighest > targetHighest;
}

/** True when @everyone cannot view the channel: the lock icon and own-key rule. */
export function isPrivateChannel(everyoneId: string, overwrites: Overwrite[] | undefined): boolean {
  const ow = overwrites?.find((o) => o.target_type === "role" && o.target_id === everyoneId);
  return !!ow && has(parsePerm(ow.deny), P.VIEW_CHANNEL);
}
