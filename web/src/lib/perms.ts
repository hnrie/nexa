/**
 * Discord-compatible permission bitsets, mirroring internal/perms on the server.
 * Bits are BigInt because several sit above 2^32; the wire form is a decimal string.
 */
import type { Member, Overwrite, Role } from "@/api/types";

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
export const PERM_GROUPS: { group: string; items: { name: PermName; label: string; description: string; channel?: ("text" | "voice")[] }[] }[] = [
  {
    group: "General Server Permissions",
    items: [
      { name: "VIEW_CHANNEL", label: "View Channels", description: "Allows members to view channels by default (excluding private channels).", channel: ["text", "voice"] },
      { name: "MANAGE_CHANNELS", label: "Manage Channels", description: "Allows members to create, edit, or delete channels.", channel: ["text", "voice"] },
      { name: "MANAGE_ROLES", label: "Manage Roles", description: "Allows members to create new roles and edit or delete roles lower than their highest role. Also allows editing channel permissions.", channel: ["text", "voice"] },
      { name: "MANAGE_EMOJIS", label: "Manage Expressions", description: "Allows members to add or remove custom emoji, stickers and sounds in this server." },
      { name: "VIEW_AUDIT_LOG", label: "View Audit Log", description: "Allows members to view a record of who made which changes in this server." },
      { name: "MANAGE_SERVER", label: "Manage Server", description: "Allows members to change this server's name, icon, description and invites." },
    ],
  },
  {
    group: "Membership Permissions",
    items: [
      { name: "CREATE_INSTANT_INVITE", label: "Create Invite", description: "Allows members to invite new people to this server.", channel: ["text", "voice"] },
      { name: "CHANGE_NICKNAME", label: "Change Nickname", description: "Allows members to change their own nickname." },
      { name: "MANAGE_NICKNAMES", label: "Manage Nicknames", description: "Allows members to change the nicknames of other members." },
      { name: "KICK_MEMBERS", label: "Kick Members", description: "Allows members to remove other members from this server. Kicked members can rejoin with an invite." },
      { name: "BAN_MEMBERS", label: "Ban Members", description: "Allows members to permanently ban other members from this server." },
      { name: "MODERATE_MEMBERS", label: "Time out Members", description: "Members with this permission can time out other members: they cannot send messages, react, or speak in voice until the timeout ends." },
    ],
  },
  {
    group: "Text Channel Permissions",
    items: [
      { name: "SEND_MESSAGES", label: "Send Messages", description: "Allows members to send messages in text channels.", channel: ["text"] },
      { name: "EMBED_LINKS", label: "Embed Links", description: "Allows links that members share to show embedded content.", channel: ["text"] },
      { name: "ATTACH_FILES", label: "Attach Files", description: "Allows members to upload files or media.", channel: ["text"] },
      { name: "ADD_REACTIONS", label: "Add Reactions", description: "Allows members to add new emoji reactions to a message.", channel: ["text"] },
      { name: "MENTION_EVERYONE", label: "Mention @everyone and All Roles", description: "Allows members to use @everyone and any role mention, notifying everyone.", channel: ["text"] },
      { name: "MANAGE_MESSAGES", label: "Manage Messages", description: "Allows members to delete messages by other members or pin any message.", channel: ["text"] },
      { name: "READ_MESSAGE_HISTORY", label: "Read Message History", description: "Allows members to read previous messages sent in channels.", channel: ["text"] },
      { name: "CREATE_POLLS", label: "Create Polls", description: "Allows members to create polls.", channel: ["text"] },
    ],
  },
  {
    group: "Voice Channel Permissions",
    items: [
      { name: "CONNECT", label: "Connect", description: "Allows members to join voice channels and hear others.", channel: ["voice"] },
      { name: "SPEAK", label: "Speak", description: "Allows members to talk in voice channels.", channel: ["voice"] },
      { name: "STREAM", label: "Video", description: "Allows members to share their video, screen share, or stream a game in this server.", channel: ["voice"] },
      { name: "USE_SOUNDBOARD", label: "Use Soundboard", description: "Allows members to send sounds from the soundboard.", channel: ["voice"] },
      { name: "USE_VAD", label: "Use Voice Activity", description: "Allows members to speak in voice channels by simply talking. When disabled, members must use Push-to-talk.", channel: ["voice"] },
      { name: "PRIORITY_SPEAKER", label: "Priority Speaker", description: "Allows members to be more easily heard in voice channels; other people's volume is lowered while they speak.", channel: ["voice"] },
      { name: "MUTE_MEMBERS", label: "Mute Members", description: "Allows members to mute other members in voice channels for everyone.", channel: ["voice"] },
      { name: "DEAFEN_MEMBERS", label: "Deafen Members", description: "Allows members to deafen other members in voice channels.", channel: ["voice"] },
      { name: "MOVE_MEMBERS", label: "Move Members", description: "Allows members to move other members between voice channels.", channel: ["voice"] },
    ],
  },
  {
    group: "Advanced Permissions",
    items: [{ name: "ADMINISTRATOR", label: "Administrator", description: "Members with this permission have every permission and bypass channel-specific permissions. This is a dangerous permission to grant." }],
  },
];

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
