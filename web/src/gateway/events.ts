import type {
  Channel,
  Emoji,
  Invite,
  KeyGrant,
  KeyNeed,
  Member,
  Message,
  Presence,
  PublicUser,
  ReadState,
  ReadyPayload,
  Relationship,
  Role,
  Server,
  ServerView,
  Snowflake,
  Sticker,
  StickerPack,
  VoiceState,
} from "@/api/types";
import type { Announcement, CaseCounts, CaseMessage, MemberCase, ModLogEntry, NexaState, People, StaffCase } from "@/api/moderation";

export type GatewayEvent =
  | { t: "ready"; d: ReadyPayload }
  | { t: "message_create"; d: Message }
  | { t: "message_update"; d: Message }
  | { t: "message_delete"; d: { id: Snowflake; channel_id: Snowflake } }
  | { t: "message_delete_bulk"; d: { ids: Snowflake[]; channel_id: Snowflake } }
  | { t: "reaction_add" | "reaction_remove"; d: { channel_id: Snowflake; message_id: Snowflake; user_id: Snowflake; emoji: string } }
  | { t: "typing"; d: { channel_id: Snowflake; user_id: Snowflake; ts: number; stop?: boolean } }
  | { t: "channel_create" | "channel_update"; d: Channel }
  | { t: "channel_delete"; d: { id: Snowflake; server_id?: Snowflake | null } }
  | { t: "channel_positions"; d: { server_id: Snowflake; channels: { id: Snowflake; position: number; parent_id: Snowflake | null }[] } }
  | { t: "server_create"; d: ServerView }
  | { t: "server_update"; d: Server }
  | { t: "server_delete"; d: { id: Snowflake } }
  | { t: "member_add"; d: { server_id: Snowflake; member: Member; user: PublicUser } }
  | { t: "member_update"; d: Member }
  | { t: "member_remove"; d: { server_id: Snowflake; user_id: Snowflake; reason: "leave" | "kick" | "ban" } }
  | { t: "role_create" | "role_update"; d: Role }
  | { t: "role_delete"; d: { id: Snowflake; server_id: Snowflake } }
  | { t: "presence"; d: Presence }
  | { t: "user_update"; d: PublicUser }
  | { t: "relationship_add"; d: Relationship }
  | { t: "relationship_remove"; d: { user_id: Snowflake } }
  | { t: "read_state"; d: ReadState }
  | { t: "voice_state"; d: VoiceState }
  | { t: "voice_signal"; d: { from: Snowflake; channel_id: Snowflake; payload: unknown } }
  | { t: "voice_error"; d: { code: string; message: string } }
  /** After a reconnect: whether the server kept this device's call for it, or it starts over. */
  | { t: "voice_resumed"; d: { channel_id: Snowflake; kept: boolean } }
  | { t: "call_ring"; d: { channel_id: Snowflake; from: Snowflake } }
  | { t: "call_end"; d: { channel_id: Snowflake; user_id?: Snowflake; reason: "declined" | "ended" } }
  | { t: "key_grant"; d: KeyGrant }
  | { t: "keys_needed"; d: KeyNeed }
  | { t: "key_rotation_needed"; d: { conv_id: Snowflake } }
  | { t: "emoji_update"; d: { server_id: Snowflake; emojis: Emoji[] } }
  | { t: "sticker_update"; d: { pack_id: Snowflake; deleted: boolean; pack?: StickerPack } }
  | { t: "sticker_recent"; d: { sticker: Sticker } }
  | { t: "pin_update"; d: { channel_id: Snowflake; message_id: Snowflake; pinned: boolean } }
  | { t: "ban_add"; d: { server_id: Snowflake; user_id: Snowflake; reason: string } }
  | { t: "ban_remove"; d: { server_id: Snowflake; user_id: Snowflake } }
  | { t: "invite_create"; d: Invite }
  | { t: "invite_delete"; d: { server_id: Snowflake; code: string } }
  | { t: "settings_update"; d: { version: number; session_id: Snowflake } }
  | { t: "session_expired"; d: unknown }
  /** A guest's time in the call is over: removed, revoked, expired, left, or the call is gone. */
  | { t: "guest_ended"; d: { reason: string } }
  /** Staff acted on this account: the notice to show, and where the account stands now. */
  | { t: "nexa_notice"; d: { case: MemberCase; people: People; state: NexaState } }
  /** This account's standing changed (read, dismissed, a mute or ban ended). */
  | { t: "nexa_state"; d: NexaState }
  /** One of this account's cases moved: new thread lines, lifted, closed, reopened. */
  | { t: "nexa_case"; d: { case: MemberCase; messages: CaseMessage[]; people: People; state: NexaState } }
  | { t: "nexa_announcement"; d: { announcement: Announcement; people: People } }
  | { t: "nexa_announcement_delete"; d: { id: Snowflake } }
  /** Staff: a case changed, with any new lines of its thread. */
  | { t: "mod_case"; d: { case: StaffCase; messages: CaseMessage[]; people: People; counts: CaseCounts } }
  /** Staff: a new line in the punishment log. */
  | { t: "mod_log"; d: { entry: ModLogEntry; people: People } }
  /** Not from the server: the gateway was closed because the account is banned. */
  | { t: "account_banned"; d?: undefined }
  | { t: "heartbeat_ack"; d?: undefined };

export type GatewayEventType = GatewayEvent["t"];

export function isGatewayFrame(x: unknown): x is { t: string; s?: number; d?: unknown } {
  return typeof x === "object" && x !== null && typeof (x as { t?: unknown }).t === "string";
}
