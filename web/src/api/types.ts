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
  /** Second colour: when set, the profile banner is a gradient between the two. */
  accent_color_2: number | null;
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
  /** An authenticator app is required to sign in. */
  mfa_enabled?: boolean;
  backup_codes_left?: number;
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
  type: "text" | "voice" | "category" | "dm" | "group_dm" | "subchat";
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
  /** The conversation whose keys encrypt this channel: itself for DMs and private channels, the server otherwise. */
  key_conv_id: Snowflake;
  /** Permission overwrites; only present on server channels. */
  overwrites?: Overwrite[];
}

/** Permission bits travel as decimal strings; `lib/perms` turns them into BigInt. */
export type PermString = string;

export interface Overwrite {
  channel_id: Snowflake;
  target_id: Snowflake;
  target_type: "role" | "member";
  allow: PermString;
  deny: PermString;
}

export interface Server {
  id: Snowflake;
  name: string;
  icon_id: Snowflake | null;
  banner_id: Snowflake | null;
  owner_id: Snowflake;
  description: string;
  system_channel_id: Snowflake | null;
  default_notifications: number;
  flags: number;
  created_at: number;
}

export interface Member {
  server_id: Snowflake;
  user_id: Snowflake;
  nickname: string;
  avatar_id: Snowflake | null;
  joined_at: number;
  timeout_until: number | null;
  flags: number;
  role_ids: Snowflake[];
}

export interface Role {
  id: Snowflake;
  server_id: Snowflake;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  position: number;
  permissions: PermString;
  icon_id: Snowflake | null;
  created_at: number;
}

/** A server as the ready payload, create and join responses carry it. */
export interface ServerView extends Server {
  channels: Channel[];
  roles: Role[];
  members: Member[];
  member_count: number;
  me: Member;
  my_permissions: PermString;
}

export interface Invite {
  code: string;
  /** Null for a group DM invite, where channel_id carries the group. */
  server_id: Snowflake | null;
  channel_id: Snowflake | null;
  inviter_id: Snowflake;
  max_uses: number;
  uses: number;
  expires_at: number | null;
  created_at: number;
}

export interface InvitePreview {
  code: string;
  /** Present for a server invite. */
  server?: { id: Snowflake; name: string; icon_id: Snowflake | null; banner_id: Snowflake | null; description: string; member_count: number; online_count: number };
  /** Present for a group DM invite. */
  group?: { id: Snowflake; name: string; icon_id: Snowflake | null; member_count: number };
  channel?: { id: Snowflake; name: string; type: Channel["type"] };
  inviter?: PublicUser;
  expires_at: number | null;
}

export interface Ban {
  server_id: Snowflake;
  user_id: Snowflake;
  reason: string;
  banned_by: Snowflake;
  created_at: number;
}

export interface AuditEntry {
  id: Snowflake;
  server_id: Snowflake;
  actor_id: Snowflake;
  action: string;
  target_type: string;
  target_id: Snowflake | null;
  changes: unknown;
  reason: string;
  created_at: number;
}

export interface Emoji {
  id: Snowflake;
  server_id: Snowflake;
  name: string;
  blob_id: Snowflake;
  animated: boolean;
  creator_id: Snowflake;
  created_at: number;
}

export interface Sticker {
  id: Snowflake;
  pack_id: Snowflake;
  name: string;
  tags: string;
  blob_id: Snowflake;
  format: "png" | "apng" | "gif" | "webp";
  position: number;
  creator_id: Snowflake;
  created_at: number;
  width?: number;
  height?: number;
  animated: boolean;
}

export interface StickerPack {
  id: Snowflake;
  /** "sticker" for the big ones you post, "emoji" for the small ones you type. */
  kind: "sticker" | "emoji";
  owner_user_id: Snowflake | null;
  server_id: Snowflake | null;
  name: string;
  description: string;
  cover_sticker_id: Snowflake | null;
  public: boolean;
  created_at: number;
  updated_at: number;
  stickers: Sticker[];
  installed: boolean;
}

/** Where a sticker seen in a message comes from: only ever a public pack. */
export interface StickerInfo {
  sticker: Sticker;
  pack: StickerPack;
  /** Whoever made the pack's stickers. */
  users: PublicUser[];
}

export interface GifResult {
  id: string;
  url: string;
  preview: string;
  w: number;
  h: number;
  title: string;
}

export interface GifPage {
  results: GifResult[];
  next: string;
}

export interface VoiceState {
  user_id: Snowflake;
  /** Null when the user left; old_channel_id then says where from. */
  channel_id: Snowflake | null;
  old_channel_id?: Snowflake;
  session_id: Snowflake;
  self_mute: boolean;
  self_deaf: boolean;
  video: boolean;
  streaming: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  joined_at: number;
  /**
   * What this participant publishes through the SFU: each kind (audio, video,
   * screen, screen_audio) with a tag that changes when that track is published again.
   */
  media?: Partial<Record<"audio" | "video" | "screen" | "screen_audio", string>>;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface AdminUser {
  id: Snowflake;
  username: string;
  display_name: string;
  flags: number;
  created_at: number;
  admin: boolean;
  disabled: boolean;
}

export interface AdminStats {
  users: number;
  servers: number;
  messages: number;
  blobs: number;
  blob_bytes: number;
  online: number;
  version: string;
}

export interface AdminSettings {
  registration: "open" | "invite" | "closed";
  registration_key_set: boolean;
  config_registration: string;
  overrides: Record<string, string>;
  max_upload_bytes: number;
  max_emoji_bytes: number;
  max_sticker_bytes: number;
  max_avatar_bytes: number;
  gif_search: boolean;
  turn: boolean;
}

export interface InstanceInfo {
  name: string;
  version: string;
  registration: "open" | "invite" | "closed";
  needs_key: boolean;
  max_upload_bytes: number;
  gif_search: boolean;
  public_url: string;
  turn_configured: boolean;
  /** Set when the actions bots abuse need a Turnstile captcha. */
  captcha?: { provider: "turnstile"; site_key: string } | null;
  /** The most one upload request may carry; a larger file goes up in pieces. */
  upload_single_bytes?: number;
  /** The size of each of those pieces. */
  upload_chunk_bytes?: number;
  max_sticker_bytes?: number;
}

export interface ServerKeyInfo {
  conv_id: Snowflake;
  name: string;
  epochs: KeyEpoch[];
  flags: KeyFlags | null;
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
  /** Other people's unread messages in a DM or group DM, up to 100; absent or 0 elsewhere. */
  unread_count?: number;
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
  /** the key is waiting to be rotated after someone lost access */
  rotate?: boolean;
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
  /** What they are doing right now, heard from programs on their computer by the desktop app. */
  activities?: Activity[];
}

/** 0 playing, 2 listening, 3 watching, 5 competing (Discord's Rich Presence types). */
export type ActivityType = 0 | 2 | 3 | 5;

/**
 * A Rich Presence activity as chatd sends it: cleaned to Discord's limits,
 * with its images already on this server's media proxy.
 */
export interface Activity {
  application_id?: string;
  name: string;
  type: ActivityType;
  /** Which text the one-line summary uses: 0 the name, 1 the state, 2 the details. */
  status_display_type?: 0 | 1 | 2;
  details?: string;
  details_url?: string;
  state?: string;
  state_url?: string;
  /** Milliseconds. A start alone counts up; a start and an end draw a progress bar. */
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string; large_url?: string; small_image?: string; small_text?: string; small_url?: string };
  party?: { id?: string; size?: [number, number] };
  buttons?: { label: string; url: string }[];
  instance?: boolean;
  icon_url?: string;
  created_at: number;
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
  servers: ServerView[];
  emojis: Emoji[];
  sticker_packs: StickerPack[];
  voice_states: VoiceState[];
}

export interface UnfurlResult {
  url: string;
  type: "link" | "image" | "gif" | "video" | "youtube" | "invite";
  title?: string;
  description?: string;
  site_name?: string;
  image?: string;
  image_w?: number;
  image_h?: number;
  video_id?: string;
  mime?: string;
  color?: string;
  /** Set when the link invites you somewhere on this instance. */
  invite_code?: string;
  member_count?: number;
  online_count?: number;
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

/** The password was right, but the account also wants a code. */
export interface MfaChallenge {
  mfa_required: true;
  ticket: string;
  backup_codes_left: number;
}

export type LoginResult = LoginResponse | MfaChallenge;

/** True when the server asked for a second factor instead of signing us in. */
export function isMfaChallenge(r: LoginResult): r is MfaChallenge {
  return (r as MfaChallenge).mfa_required === true;
}

export interface MfaStatus {
  enabled: boolean;
  backup_codes_left: number;
  enabled_at?: number;
}

export interface TotpSetup {
  secret: string;
  formatted: string;
  uri: string;
  ticket: string;
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
