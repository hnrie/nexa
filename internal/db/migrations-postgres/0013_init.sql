-- The schema chatd runs on Postgres, generated from the SQLite one
-- (internal/db/migrations) so the two cannot drift: same tables, same columns,
-- same indexes, same foreign keys.
--
-- Ids are snowflakes this process generates, not sequences, so every id column
-- is a plain BIGINT with no default. Times are Unix milliseconds. Booleans are
-- 0/1 BIGINTs, as they are in SQLite, so every query reads the same either way.
--
-- Do not edit by hand: run tools/gen_pg_schema.sh.

CREATE TABLE blobs (
  id BIGINT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size BIGINT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,               -- avatar | banner | icon | emoji | sticker | attachment
  encrypted BIGINT NOT NULL DEFAULT 0,
  ref_count BIGINT NOT NULL DEFAULT 0,
  owner_id BIGINT,                 -- uploader; used for attachments that are not attached yet
  width BIGINT,
  height BIGINT,
  animated BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  kdf_salt BYTEA NOT NULL,
  kdf_params TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  enc_private_key BYTEA NOT NULL,
  enc_private_key_recovery BYTEA,
  recovery_auth_hash TEXT,
  avatar_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  banner_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  about_me TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  accent_color BIGINT,
  status_text TEXT NOT NULL DEFAULT '',
  status_emoji TEXT NOT NULL DEFAULT '',
  status_expires_at BIGINT,
  presence_pref TEXT NOT NULL DEFAULT 'online',
  dm_privacy TEXT NOT NULL DEFAULT 'everyone',   -- everyone | friends | nobody
  flags BIGINT NOT NULL DEFAULT 0,              -- 1 = instance admin, 2 = disabled, 4 = deleted
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
, accent_color_2 BIGINT);

CREATE TABLE servers (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  banner_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  owner_id BIGINT NOT NULL REFERENCES users(id),
  description TEXT NOT NULL DEFAULT '',
  system_channel_id BIGINT,
  default_notifications BIGINT NOT NULL DEFAULT 0,  -- 0 all messages, 1 only mentions
  flags BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE channels (
  id BIGINT PRIMARY KEY,
  server_id BIGINT REFERENCES servers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- text | voice | category | dm | group_dm
  name TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  position BIGINT NOT NULL DEFAULT 0,
  parent_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
  nsfw BIGINT NOT NULL DEFAULT 0,
  slowmode_seconds BIGINT NOT NULL DEFAULT 0,
  user_limit BIGINT NOT NULL DEFAULT 0,
  owner_id BIGINT,
  icon_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  last_message_id BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
, lock_salt BYTEA, lock_params TEXT NOT NULL DEFAULT '', lock_hash TEXT NOT NULL DEFAULT '');

CREATE TABLE messages (
  id BIGINT PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'default',
  ciphertext TEXT,                  -- JSON envelope; NULL for system messages
  key_conv_id BIGINT,
  key_epoch BIGINT,
  reply_to_id BIGINT,
  mentions TEXT NOT NULL DEFAULT '[]',
  mention_roles TEXT NOT NULL DEFAULT '[]',
  mention_everyone BIGINT NOT NULL DEFAULT 0,
  has_attachments BIGINT NOT NULL DEFAULT 0,
  flags BIGINT NOT NULL DEFAULT 0, -- 1 pinned, 4 suppress embeds
  nonce TEXT,
  edited_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE attachments (
  id BIGINT PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL,
  uploader_id BIGINT NOT NULL,
  blob_id BIGINT NOT NULL REFERENCES blobs(id),
  size BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE audit_log (
  id BIGINT PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id BIGINT,
  changes TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE bans (
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  banned_by BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE channel_overwrites (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL,
  target_type TEXT NOT NULL,        -- role | member
  allow BIGINT NOT NULL DEFAULT 0,
  deny BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE sessions (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE TABLE channel_unlocks (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (channel_id, session_id)
);

CREATE TABLE client_errors (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'error',   -- error | render | promise
  message    TEXT NOT NULL,
  stack      TEXT NOT NULL DEFAULT '',
  component  TEXT NOT NULL DEFAULT '',
  path       TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  version    TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE dm_participants (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by BIGINT,
  added_at BIGINT NOT NULL, hidden BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE emojis (
  id BIGINT PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  blob_id BIGINT NOT NULL REFERENCES blobs(id),
  animated BIGINT NOT NULL DEFAULT 0,
  creator_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE guest_links (
  code TEXT PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- the conversation key epoch whose call key the link carries
  epoch BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE guests (
  id BIGINT PRIMARY KEY,
  link_code TEXT NOT NULL REFERENCES guest_links(code) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  epoch BIGINT NOT NULL,
  session_id BIGINT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  server_id BIGINT REFERENCES servers(id) ON DELETE CASCADE,
  channel_id BIGINT,
  inviter_id BIGINT NOT NULL,
  max_uses BIGINT NOT NULL DEFAULT 0,
  uses BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE key_epochs (
  conv_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (conv_id, epoch)
);

CREATE TABLE key_flags (
  conv_id BIGINT PRIMARY KEY,
  needs_rotation BIGINT NOT NULL DEFAULT 0,
  needs_own_key BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE key_grants (
  conv_id BIGINT NOT NULL,
  epoch BIGINT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key BYTEA NOT NULL,
  wrapped_by BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (conv_id, epoch, user_id),
  FOREIGN KEY (conv_id, epoch) REFERENCES key_epochs(conv_id, epoch) ON DELETE CASCADE
);

CREATE TABLE roles (
  id BIGINT PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color BIGINT NOT NULL DEFAULT 0,
  hoist BIGINT NOT NULL DEFAULT 0,
  mentionable BIGINT NOT NULL DEFAULT 0,
  position BIGINT NOT NULL DEFAULT 0,
  permissions BIGINT NOT NULL DEFAULT 0,
  icon_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE server_members (
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '',
  avatar_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  joined_at BIGINT NOT NULL,
  timeout_until BIGINT,
  flags BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE member_roles (
  server_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES server_members(server_id, user_id) ON DELETE CASCADE
);

CREATE TABLE mfa_backup_codes (
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,                  -- keyed hash, never the code itself
  used_at   BIGINT,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE mod_announcements (
  id BIGINT PRIMARY KEY,
  author_id BIGINT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE mod_cases (
  id BIGINT PRIMARY KEY,
  number BIGINT NOT NULL UNIQUE,              -- #1, #2, … as people refer to it
  user_id BIGINT NOT NULL,                    -- the account acted on; no foreign key, the record outlives it
  moderator_id BIGINT NOT NULL,
  action TEXT NOT NULL,                        -- avatar_remove | field_reset | mute | ban | delete
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',          -- JSON: exactly what was done (fields and values, duration)
  target_username TEXT NOT NULL,               -- the account as it was when it was acted on
  target_display_name TEXT NOT NULL,
  expires_at BIGINT,                          -- when a mute or ban runs out; NULL when permanent or not timed
  lifted_at BIGINT,                           -- a mute or ban a moderator ended early
  lifted_by BIGINT,
  lift_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',         -- open | closed
  closed_at BIGINT,
  closed_by BIGINT,
  awaiting TEXT NOT NULL DEFAULT 'none',       -- who the thread is waiting on: staff | member | none
  last_activity_at BIGINT NOT NULL,
  member_read_id BIGINT NOT NULL DEFAULT 0,   -- the newest thread message the member has seen
  notice_ack_at BIGINT,                       -- when the member dismissed the notice; until then it pops up again
  created_at BIGINT NOT NULL
);

CREATE TABLE mod_log (
  id BIGINT PRIMARY KEY,
  action TEXT NOT NULL,
  moderator_id BIGINT NOT NULL,
  moderator_username TEXT NOT NULL,
  target_id BIGINT,
  target_username TEXT NOT NULL DEFAULT '',
  case_id BIGINT,
  case_number BIGINT,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE mod_messages (
  id BIGINT PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES mod_cases(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                          -- member | staff | system
  event TEXT NOT NULL DEFAULT '',              -- for system lines: lifted | closed | reopened | expired | replaced
  body TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE mod_restrictions (
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                          -- mute | ban
  case_id BIGINT NOT NULL,
  expires_at BIGINT,                          -- NULL: until a moderator lifts it
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE nexa_reads (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seen_at BIGINT NOT NULL
);

CREATE TABLE pins (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by BIGINT NOT NULL,
  pinned_at BIGINT NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE polls (
  message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  options_count BIGINT NOT NULL,
  multiselect BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT
);

CREATE TABLE poll_votes (
  message_id BIGINT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  option_index BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id, option_index)
);

CREATE TABLE reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE read_states (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id BIGINT,
  last_ack_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE realtime_usage (
  month TEXT PRIMARY KEY,
  bytes BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE sticker_packs (
  id BIGINT PRIMARY KEY,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  server_id BIGINT REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_sticker_id BIGINT,
  public BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
, kind TEXT NOT NULL DEFAULT 'sticker');

CREATE TABLE stickers (
  id BIGINT PRIMARY KEY,
  pack_id BIGINT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  blob_id BIGINT NOT NULL REFERENCES blobs(id),
  format TEXT NOT NULL,             -- png | apng | gif | webp
  position BIGINT NOT NULL DEFAULT 0,
  creator_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE recent_stickers (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sticker_id BIGINT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
  used_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, sticker_id)
);

CREATE TABLE relationships (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- friend | outgoing | incoming | blocked
  nickname TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE sticker_installs (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id BIGINT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  installed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE uploads (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size       BIGINT NOT NULL,   -- what the client said it would send
  received   BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
, blob_id BIGINT);

CREATE TABLE user_mfa (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret BYTEA NOT NULL,
  last_step   BIGINT NOT NULL DEFAULT 0,   -- newest counter already spent, so a code is single-use
  enabled     BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);

CREATE TABLE user_settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blob BYTEA NOT NULL,
  version BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE username_holds (
  username TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX attachments_blob ON attachments(blob_id);

CREATE INDEX attachments_message ON attachments(message_id);

CREATE INDEX audit_log_server ON audit_log(server_id, id DESC);

CREATE UNIQUE INDEX blobs_sha_kind ON blobs(sha256, kind);

CREATE INDEX blobs_unreferenced ON blobs(ref_count, created_at);

CREATE INDEX channels_parent ON channels(parent_id);

CREATE INDEX channels_server ON channels(server_id, position);

CREATE INDEX client_errors_time ON client_errors(created_at DESC);

CREATE INDEX dm_participants_user ON dm_participants(user_id);

CREATE UNIQUE INDEX emojis_server_name ON emojis(server_id, name);

CREATE INDEX guest_links_channel ON guest_links(channel_id);

CREATE INDEX guests_channel ON guests(channel_id);

CREATE INDEX guests_link ON guests(link_code);

CREATE INDEX idx_channel_unlocks_session ON channel_unlocks(session_id);

CREATE INDEX idx_recent_stickers_user ON recent_stickers(user_id, used_at DESC);

CREATE INDEX invites_channel ON invites(channel_id);

CREATE INDEX invites_server ON invites(server_id);

CREATE INDEX key_grants_user ON key_grants(user_id);

CREATE INDEX member_roles_role ON member_roles(role_id);

CREATE INDEX messages_author ON messages(author_id);

CREATE INDEX messages_channel ON messages(channel_id, id DESC);

CREATE UNIQUE INDEX messages_nonce ON messages(channel_id, author_id, nonce) WHERE nonce IS NOT NULL;

CREATE INDEX mod_cases_activity ON mod_cases(status, last_activity_at DESC);

CREATE INDEX mod_cases_awaiting ON mod_cases(awaiting, last_activity_at DESC);

CREATE INDEX mod_cases_user ON mod_cases(user_id, id DESC);

CREATE INDEX mod_log_action ON mod_log(action, id DESC);

CREATE INDEX mod_log_moderator ON mod_log(moderator_id, id DESC);

CREATE INDEX mod_log_target ON mod_log(target_id, id DESC);

CREATE INDEX mod_messages_case ON mod_messages(case_id, id);

CREATE INDEX mod_restrictions_expiry ON mod_restrictions(expires_at);

CREATE INDEX relationships_target ON relationships(target_id);

CREATE INDEX roles_server ON roles(server_id, position);

CREATE INDEX server_members_user ON server_members(user_id);

CREATE INDEX sessions_user ON sessions(user_id);

CREATE INDEX sticker_packs_kind ON sticker_packs(kind, public, updated_at DESC);

CREATE INDEX sticker_packs_owner ON sticker_packs(owner_user_id);

CREATE INDEX sticker_packs_public ON sticker_packs(public, updated_at DESC);

CREATE INDEX sticker_packs_server ON sticker_packs(server_id);

CREATE INDEX stickers_pack ON stickers(pack_id, position);

CREATE INDEX uploads_stale ON uploads(updated_at);

CREATE INDEX username_holds_user ON username_holds(user_id);

CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END
$$;

CREATE TRIGGER mod_log_no_delete BEFORE DELETE ON mod_log FOR EACH ROW EXECUTE FUNCTION refuse_change('mod_log is append-only');

CREATE TRIGGER mod_log_no_update BEFORE UPDATE ON mod_log FOR EACH ROW EXECUTE FUNCTION refuse_change('mod_log is append-only');
