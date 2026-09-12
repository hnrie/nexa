/**
 * Wire types for the chatd REST API and gateway.
 *
 * The server's conventions, once, so nothing downstream has to guess: every id
 * is a decimal string, every timestamp is Unix milliseconds, and every binary
 * field (`public_key`, `enc_private_key`, `kdf_salt`, `wrapped_key`, `blob`) is
 * standard base64.
 */

import type { Envelope } from "@/crypto/message";

/** A 64-bit id, rendered as a decimal string so it survives JSON. */
export type Snowflake = string;

export interface PublicUser {
  id: Snowflake;
  username: string;
  display_name: string;
  avatar_id: Snowflake | null;
  banner_id: Snowflake | null;
  about_me: string;
  pronouns: string;
  accent_color: number | null;
  status_text: string;
  status_emoji: string;
  status_expires_at: number | null;
  /** base64 X25519 public key. */
  public_key: string;
  flags: number;
  created_at: number;
}

/** The extra fields the server only ever hands to the account's owner. */
export interface MeUser extends PublicUser {
  presence_pref: "online" | "idle" | "dnd" | "invisible";
  dm_privacy: "everyone" | "friends" | "nobody";
  has_recovery: boolean;
}

export type User = PublicUser;

export interface Session {
  id: Snowflake;
  user_agent: string;
  ip: string;
  created_at: number;
  last_seen_at: number;
  current: boolean;
}

export interface Channel {
  id: Snowflake;
  server_id: Snowflake | null;
  type: "text" | "voice" | "category" | "dm" | "group_dm";
  name: string;
  topic: string;
  position: number;
  parent_id: Snowflake | null;
  nsfw: boolean;
  slowmode_seconds: number;
  user_limit: number;
  owner_id: Snowflake | null;
  icon_id: Snowflake | null;
  last_message_id: Snowflake | null;
  created_at: number;
  recipient_ids: Snowflake[];
}

export interface Attachment {
  id: Snowflake;
  blob_id: Snowflake;
  size: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
}

export type MessageType =
  | "default"
  | "reply"
  | "system_join"
  | "system_pin"
  | "system_call"
  | "system_member_add"
  | "system_member_remove";

export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  author_id: Snowflake;
  /** Widened with `string` so an unknown future type does not break parsing. */
  type: MessageType | string;
  ciphertext: Envelope | null;
  key_conv_id: Snowflake | null;
  key_epoch: number | null;
  reply_to_id: Snowflake | null;
  mentions: Snowflake[];
  mention_roles: Snowflake[];
  mention_everyone: boolean;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  flags: number;
  /** The sender's idempotency key, echoed back so a client can match its optimistic copy. */
  nonce?: string;
  edited_at: number | null;
  created_at: number;
}

export const MSG_FLAG_PINNED = 1;
export const MSG_FLAG_SUPPRESS_EMBEDS = 4;

export interface Relationship {
  user: PublicUser;
  type: "friend" | "outgoing" | "incoming" | "blocked";
  nickname: string;
  created_at: number;
}

export interface ReadState {
  channel_id: Snowflake;
  last_read_message_id: Snowflake | null;
  last_ack_at: number;
  mention_count: number;
}

export interface KeyGrant {
  conv_id: Snowflake;
  epoch: number;
  user_id: Snowflake;
  /** base64 of the conversation key sealed to `user_id`. */
  wrapped_key: string;
  wrapped_by: Snowflake;
  created_at: number;
}

export interface KeyNeed {
  conv_id: Snowflake;
  epoch: number;
  user_ids: Snowflake[];
}

export interface KeyEpoch {
  conv_id: Snowflake;
  epoch: number;
  created_by: Snowflake;
  created_at: number;
  reason: string;
}

export interface KeyFlags {
  conv_id: Snowflake;
  needs_rotation: boolean;
  needs_own_key: boolean;
}

export interface Presence {
  user_id: Snowflake;
  status: "online" | "idle" | "dnd" | "offline" | "invisible";
  status_text: string;
  status_emoji: string;
  status_expires_at: number | null;
}

export interface SettingsBlob {
  /** base64 of the client-encrypted settings document. */
  blob: string;
  version: number;
  updated_at?: number;
}

export interface ReadyPayload {
  session_id: Snowflake;
  user: MeUser;
  users: PublicUser[];
  channels: Channel[];
  relationships: Relationship[];
  read_states: ReadState[];
  presences: Presence[];
  key_grants: KeyGrant[];
  settings: SettingsBlob | null;
  servers: unknown[];
  voice_states: unknown[];
}

export interface UnfurlResult {
  url: string;
  type: "link" | "image" | "gif" | "video" | "youtube";
  title?: string;
  description?: string;
  site_name?: string;
  image?: string;
  image_w?: number;
  image_h?: number;
  video_id?: string;
  mime?: string;
  color?: string;
}

export interface KdfParamsJson {
  m: number;
  t: number;
  p: number;
  v: 1;
}

export interface RegisterRequest {
  username: string;
  display_name: string;
  auth_key: string;
  kdf_salt: string;
  kdf_params: KdfParamsJson;
  public_key: string;
  enc_private_key: string;
  enc_private_key_recovery?: string;
  recovery_auth_key?: string;
  invite_code?: string;
  registration_key?: string;
}

export interface AuthResponse {
  user: MeUser;
  token: string;
}

export interface LoginResponse extends AuthResponse {
  enc_private_key: string;
  public_key: string;
  kdf_salt: string;
  kdf_params: KdfParamsJson;
}

export interface SendMessageRequest {
  ciphertext: Envelope;
  key_conv_id: Snowflake;
  key_epoch: number;
  reply_to_id?: Snowflake;
  mentions: Snowflake[];
  mention_roles?: Snowflake[];
  mention_everyone?: boolean;
  attachments?: { blob_id: Snowflake; size: number }[];
  /** Client-generated idempotency key for the send. */
  nonce: string;
  flags?: number;
}
