/**
 * Wire types for the chatd REST API and gateway.
 *
 * The server's conventions, once, so nothing downstream has to guess: every id
 * is a decimal string, every timestamp is Unix milliseconds, and every binary
 * field (`public_key`, `enc_private_key`, `kdf_salt`, `wrapped_key`, `blob`) is
 * standard base64.
 */

import type { NexaState } from "./moderation";
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
  /**
   * Joins group chats only from an invite link ("Let friends add me to group
   * chats" is off): friends see them as Link Only and cannot add them directly.
   */
  group_link_only?: boolean;
  created_at: number;
}

/** The extra fields the server only ever hands to the account's owner. */
export interface MeUser extends PublicUser {
  presence_pref: "online" | "idle" | "dnd" | "invisible";
  /** Who may start a direct message with the account; "friends_servers" (friends and people in a server with it) is the default. */
  dm_privacy: "everyone" | "friends_servers" | "friends" | "nobody";
  has_recovery: boolean;
  /** An authenticator app is required to sign in. */
  mfa_enabled?: boolean;
  backup_codes_left?: number;
  /** The account's moderation standing: a mute or ban in force, notices to show. */
  nexa?: NexaState;
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
  /** A subchat that asks for its password before it opens. */
  locked?: boolean;
  /** A server channel's own icon in place of its # or speaker (see lib/channelGlyph); absent for none. */
  glyph?: string;
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
  format: "png" | "apng" | "gif" | "webp" | "tgs" | "webm";
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
  /** Enough of the participant to show them in the call; all a guest ever learns about anyone. */
  user?: CallUser;
  /** Set for someone in through a guest link, with the key epoch their link carried. */
  guest?: { epoch: number };
  /** On a leave: "moved" when another device of the same account picked the call up. */
  reason?: "moved";
}

/** The flag on a user who is a guest in a call rather than an account. */
export const GUEST_FLAG = 8;

export interface CallUser {
  id: Snowflake;
  display_name: string;
  avatar_id: Snowflake | null;
  flags: number;
}

/** A link that lets people without an account into one call. */
export interface GuestLink {
  code: string;
  channel_id: Snowflake;
  creator_id: Snowflake;
  /** The key epoch whose call key the link carries. */
  epoch: number;
  created_at: number;
  expires_at: number;
  /** How many guests are in through it now. */
  guests: number;
}

/** What a guest is told about their own stay. */
export interface GuestInfo {
  id: Snowflake;
  display_name: string;
  channel_id: Snowflake;
  epoch: number;
  expires_at: number;
  /** Whether calls go through the SFU, and so need the link's key. */
  sfu: boolean;
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
  /** This month's estimated call traffic against the instance's allowance; absent when calls are not metered. */
  realtime?: { month: string; used_bytes: number; limit_bytes: number; video_paused: boolean; calls_paused: boolean } | null;
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

/**
 * A compiled law-enforcement response: everything this instance already holds
 * about one account, as a document to send back to an officer.
 *
 * `document` is English legal prose written by the server and is deliberately
 * not translated — it may end up attached to a filing, where wording that
 * changes with the operator's interface language would be worth less.
 */
export interface LegalReport {
  user_id: Snowflake;
  username: string;
  /** When the snapshot was taken, in Unix milliseconds. */
  generated_at: number;
  /** What the download should be called. */
  filename: string;
  document: string;
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
  | "system_member_remove"
  | "system_poll_result";

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
  /** Set on a message a webhook posted: which webhook, and what it said (not encrypted; see lib/webhookMessage). */
  webhook_id?: Snowflake;
  webhook?: unknown;
  /** How a webhook message's poll stands, for whoever loaded it. */
  poll_results?: PollTally;
}

export const MSG_FLAG_PINNED = 1;
export const MSG_FLAG_SUPPRESS_EMBEDS = 4;
/** No sound or notification; it still counts as unread. */
export const MSG_FLAG_SUPPRESS_NOTIFICATIONS = 1 << 12;
/** A webhook message laid out entirely by its components. */
export const MSG_FLAG_COMPONENTS_V2 = 1 << 15;

/** A poll's votes, as the server counts them for the reader. */
export interface PollTally {
  answer_counts: { id: number; count: number; me_voted: boolean }[];
  total_voters: number;
  expires_at: number | null;
  is_finalized: boolean;
}

/** An incoming webhook, as the people who manage it see it. */
export interface Webhook {
  id: Snowflake;
  type: number;
  server_id: Snowflake;
  channel_id: Snowflake;
  name: string;
  /** The blob id of its picture, served as an avatar. */
  avatar: Snowflake | null;
  token?: string;
  url?: string;
  user?: { id: Snowflake; username: string; display_name: string; avatar_id: Snowflake | null };
  created_at: number;
}

export interface Relationship {
  user: PublicUser;
  type: "friend" | "outgoing" | "incoming" | "blocked";
  nickname: string;
  /** On an incoming request, the note it came with: a sealed box (base64) only this account can open. */
  note?: string;
  created_at: number;
}

export interface ReadState {
  channel_id: Snowflake;
  last_read_message_id: Snowflake | null;
  last_ack_at: number;
  mention_count: number;
  /** Other people's unread messages in a DM or group DM, up to 100; absent or 0 elsewhere. */
  unread_count?: number;
  /** Set by Mark Unread, the one change that moves the read marker back. */
  manual?: boolean;
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

/**
 * Nexa's note to someone a friend put in a group directly: who added them and
 * when. Only that person is ever sent it, until they dismiss it.
 */
export interface GroupAddNotice {
  channel_id: Snowflake;
  added_by: Snowflake;
  added_at: number;
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
  /** This account's own notes about being added to a group by a friend, not yet dismissed. */
  group_add_notices?: GroupAddNotice[];
  /** Only in a guest's ready: which call they are in. */
  guest?: GuestInfo;
  /** The account's moderation standing. */
  nexa?: NexaState;
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
  author?: string;
  author_url?: string;
  /** When the page says it was published, in Unix milliseconds. */
  published_at?: number;
  /** The site's own small icon. */
  icon?: string;
  /** A file the browser plays by itself: no frame, nobody else's code. */
  media?: string;
  media_kind?: "video" | "audio";
  media_mime?: string;
  media_w?: number;
  media_h?: number;
  /** A video player's frame, built by the server from a fixed list of sites. */
  player?: string;
  player_site?: string;
  /** Set when the link invites you somewhere on this instance. */
  invite_code?: string;
  member_count?: number;
  online_count?: number;
  /** An invite's server banner. */
  banner?: string;
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
