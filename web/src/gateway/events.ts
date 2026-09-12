import type {
  Channel,
  KeyGrant,
  KeyNeed,
  Message,
  Presence,
  PublicUser,
  ReadState,
  ReadyPayload,
  Relationship,
  Snowflake,
} from "@/api/types";

export type GatewayEvent =
  | { t: "ready"; d: ReadyPayload }
  | { t: "message_create"; d: Message }
  | { t: "message_update"; d: Message }
  | { t: "message_delete"; d: { id: Snowflake; channel_id: Snowflake } }
  | { t: "message_delete_bulk"; d: { ids: Snowflake[]; channel_id: Snowflake } }
  | { t: "reaction_add" | "reaction_remove"; d: { channel_id: Snowflake; message_id: Snowflake; user_id: Snowflake; emoji: string } }
  | { t: "typing"; d: { channel_id: Snowflake; user_id: Snowflake; ts: number } }
  | { t: "channel_create" | "channel_update"; d: Channel }
  | { t: "channel_delete"; d: { id: Snowflake } }
  | { t: "channel_positions"; d: unknown }
  | { t: "server_create" | "server_update"; d: unknown }
  | { t: "server_delete"; d: { id: Snowflake } }
  | { t: "member_add" | "member_update" | "member_remove"; d: unknown }
  | { t: "role_create" | "role_update" | "role_delete"; d: unknown }
  | { t: "presence"; d: Presence }
  | { t: "user_update"; d: PublicUser }
  | { t: "relationship_add"; d: Relationship }
  | { t: "relationship_remove"; d: { user_id: Snowflake } }
  | { t: "read_state"; d: ReadState }
  | { t: "voice_state" | "voice_signal" | "call_ring" | "call_end"; d: unknown }
  | { t: "key_grant"; d: KeyGrant }
  | { t: "keys_needed"; d: KeyNeed }
  | { t: "key_rotation_needed"; d: { conv_id: Snowflake } }
  | { t: "emoji_update" | "sticker_update"; d: unknown }
  | { t: "pin_update"; d: { channel_id: Snowflake; message_id: Snowflake; pinned: boolean } }
  | { t: "ban_add" | "ban_remove" | "invite_create" | "invite_delete"; d: unknown }
  | { t: "settings_update"; d: { version: number; session_id: Snowflake } }
  | { t: "session_expired"; d: unknown }
  | { t: "heartbeat_ack"; d?: undefined };

export type GatewayEventType = GatewayEvent["t"];

export function isGatewayFrame(x: unknown): x is { t: string; s?: number; d?: unknown } {
  return typeof x === "object" && x !== null && typeof (x as { t?: unknown }).t === "string";
}
