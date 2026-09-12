-- Evilion Chat schema, version 1. See docs/superpowers/specs/2026-09-11-chat-design.md §4.
-- Ids are snowflakes (INTEGER). Times are Unix milliseconds. Booleans are 0/1.

CREATE TABLE blobs (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,               -- avatar | banner | icon | emoji | sticker | attachment
  encrypted INTEGER NOT NULL DEFAULT 0,
  ref_count INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER,                 -- uploader; used for attachments that are not attached yet
  width INTEGER,
  height INTEGER,
  animated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX blobs_sha_kind ON blobs(sha256, kind);
CREATE INDEX blobs_unreferenced ON blobs(ref_count, created_at);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  kdf_salt BLOB NOT NULL,
  kdf_params TEXT NOT NULL,
  public_key BLOB NOT NULL,
  enc_private_key BLOB NOT NULL,
  enc_private_key_recovery BLOB,
  recovery_auth_hash TEXT,
  avatar_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  banner_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  about_me TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  accent_color INTEGER,
  status_text TEXT NOT NULL DEFAULT '',
  status_emoji TEXT NOT NULL DEFAULT '',
  status_expires_at INTEGER,
  presence_pref TEXT NOT NULL DEFAULT 'online',
  dm_privacy TEXT NOT NULL DEFAULT 'everyone',   -- everyone | friends | nobody
  flags INTEGER NOT NULL DEFAULT 0,              -- 1 = instance admin, 2 = disabled, 4 = deleted
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blob BLOB NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE relationships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- friend | outgoing | incoming | blocked
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_id)
);
CREATE INDEX relationships_target ON relationships(target_id);

CREATE TABLE servers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  banner_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL DEFAULT '',
  system_channel_id INTEGER,
  default_notifications INTEGER NOT NULL DEFAULT 0,  -- 0 all messages, 1 only mentions
  flags INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE server_members (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '',
  avatar_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  joined_at INTEGER NOT NULL,
  timeout_until INTEGER,
  flags INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX server_members_user ON server_members(user_id);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  permissions INTEGER NOT NULL DEFAULT 0,
  icon_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX roles_server ON roles(server_id, position);

CREATE TABLE member_roles (
  server_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES server_members(server_id, user_id) ON DELETE CASCADE
);
CREATE INDEX member_roles_role ON member_roles(role_id);

CREATE TABLE channels (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- text | voice | category | dm | group_dm
  name TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  nsfw INTEGER NOT NULL DEFAULT 0,
  slowmode_seconds INTEGER NOT NULL DEFAULT 0,
  user_limit INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER,
  icon_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  last_message_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX channels_server ON channels(server_id, position);
CREATE INDEX channels_parent ON channels(parent_id);

CREATE TABLE channel_overwrites (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,        -- role | member
  allow INTEGER NOT NULL DEFAULT 0,
  deny INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE dm_participants (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX dm_participants_user ON dm_participants(user_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'default',
  ciphertext TEXT,                  -- JSON envelope; NULL for system messages
  key_conv_id INTEGER,
  key_epoch INTEGER,
  reply_to_id INTEGER,
  mentions TEXT NOT NULL DEFAULT '[]',
  mention_roles TEXT NOT NULL DEFAULT '[]',
  mention_everyone INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0, -- 1 pinned, 4 suppress embeds
  nonce TEXT,
  edited_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_channel ON messages(channel_id, id DESC);
CREATE INDEX messages_author ON messages(author_id);
CREATE UNIQUE INDEX messages_nonce ON messages(channel_id, author_id, nonce) WHERE nonce IS NOT NULL;

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL,
  uploader_id INTEGER NOT NULL,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_message ON attachments(message_id);
CREATE INDEX attachments_blob ON attachments(blob_id);

CREATE TABLE reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE pins (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by INTEGER NOT NULL,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE read_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id INTEGER,
  last_ack_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id INTEGER,
  inviter_id INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_server ON invites(server_id);

CREATE TABLE bans (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  banned_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  changes TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_server ON audit_log(server_id, id DESC);

CREATE TABLE emojis (
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  animated INTEGER NOT NULL DEFAULT 0,
  creator_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX emojis_server_name ON emojis(server_id, name);

CREATE TABLE sticker_packs (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_sticker_id INTEGER,
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sticker_packs_owner ON sticker_packs(owner_user_id);
CREATE INDEX sticker_packs_server ON sticker_packs(server_id);
CREATE INDEX sticker_packs_public ON sticker_packs(public, updated_at DESC);

CREATE TABLE stickers (
  id INTEGER PRIMARY KEY,
  pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  format TEXT NOT NULL,             -- png | apng | gif | webp
  position INTEGER NOT NULL DEFAULT 0,
  creator_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX stickers_pack ON stickers(pack_id, position);

CREATE TABLE sticker_installs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE key_epochs (
  conv_id INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (conv_id, epoch)
);

CREATE TABLE key_grants (
  conv_id INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key BLOB NOT NULL,
  wrapped_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conv_id, epoch, user_id),
  FOREIGN KEY (conv_id, epoch) REFERENCES key_epochs(conv_id, epoch) ON DELETE CASCADE
);
CREATE INDEX key_grants_user ON key_grants(user_id);

CREATE TABLE key_flags (
  conv_id INTEGER PRIMARY KEY,
  needs_rotation INTEGER NOT NULL DEFAULT 0,
  needs_own_key INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE polls (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  options_count INTEGER NOT NULL,
  multiselect INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER
);

CREATE TABLE poll_votes (
  message_id INTEGER NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  option_index INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option_index)
);

CREATE TABLE instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
