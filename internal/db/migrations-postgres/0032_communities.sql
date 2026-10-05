-- Communities: role styles, server profiles, how people joined, paused invites,
-- Discovery, safety settings, threads, forums, announcement following, AutoMod.

-- A role's name in two colours is a gradient between them, in three a shimmer
-- across all three. Its icon is a picture (icon_id) or an emoji: a character,
-- or "custom:<emoji id>" for one of the server's own.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color2 BIGINT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color3 BIGINT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS icon_emoji TEXT NOT NULL DEFAULT '';

-- A member's profile in one server: banner, about me and pronouns beside the
-- nickname and avatar it already had. And how they came in: join_method is
-- invite, discovery, tag or owner ('' for anyone who joined before it was
-- recorded), join_code the invite used, invited_by whoever made that invite.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS banner_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS pronouns TEXT NOT NULL DEFAULT '';
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS join_method TEXT NOT NULL DEFAULT '';
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS join_code TEXT NOT NULL DEFAULT '';
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS invited_by BIGINT;
-- The rest of a profile, for one server alone: its two theme colours, and its
-- widgets (NULL uses the account's own, '' shows none).
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS accent_color BIGINT;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS accent_color_2 BIGINT;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS widgets TEXT;

-- Joins are refused while invites_paused_until is in the future. A server in
-- Discovery is listed with its description, a category, up to five tags and a
-- language; discovery_hidden is Nexa's staff taking it off the list.
-- verify_account_minutes and verify_member_minutes are how old an account,
-- and how long a membership, has to be before it can talk in the server.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS invites_paused_until BIGINT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discoverable BIGINT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_category TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_tags TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_language TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_since BIGINT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discovery_hidden BIGINT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verify_account_minutes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verify_member_minutes BIGINT NOT NULL DEFAULT 0;
-- when the rules members' apps apply last changed (0: there are none)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS automod_at BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS servers_discoverable ON servers(discoverable, discovery_hidden);

-- Threads (types thread and private_thread) are channels whose parent is a
-- text, announcement or forum channel. archived threads have gone quiet or
-- were closed; thread_locked ones only moderators can open again;
-- auto_archive is how many quiet minutes close one (on a text or forum
-- channel, the default for its new threads); starter_id the message a thread
-- was started from; message_count what has been said in it; applied_tags a
-- forum post's tags (a JSON list of tag ids). forum holds a forum channel's
-- own settings as JSON: tags, default reaction, sort, layout, whether a tag
-- is required, the pinned post.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS archived BIGINT NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS archived_at BIGINT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS thread_locked BIGINT NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_archive BIGINT NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS starter_id BIGINT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS message_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS applied_tags TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS forum TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS channels_starter ON channels(starter_id);

-- Who is in a thread: the people who joined it, wrote in it or were added.
-- A private thread is seen only by them and by moderators.
CREATE TABLE IF NOT EXISTS thread_members (
  thread_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS thread_members_user ON thread_members(user_id);

-- An announcement channel followed into a channel of another server. Posts
-- published there are sealed to public_key; its private half, sealed with the
-- target channel's own key (secret, an envelope the server cannot open), is
-- how the people in that channel read them.
CREATE TABLE IF NOT EXISTS channel_follows (
  id BIGINT PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id BIGINT,
  public_key BYTEA NOT NULL,
  secret TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_follows_pair ON channel_follows(source_id, target_id);
CREATE INDEX IF NOT EXISTS channel_follows_target ON channel_follows(target_id);
CREATE INDEX IF NOT EXISTS channel_follows_server ON channel_follows(server_id);

-- Each copy of a published post, by the post it is a copy of (which may since
-- have been deleted: the copy then says so).
CREATE TABLE IF NOT EXISTS crossposts (
  message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  source_id BIGINT NOT NULL,
  follow_id BIGINT
);
CREATE INDEX IF NOT EXISTS crossposts_source ON crossposts(source_id);

-- AutoMod: a server's rules. kind says what a rule looks for, config how
-- (JSON), actions what happens (JSON). Messages are encrypted, so the rules
-- that read them are applied by each member's app; the server applies the
-- ones it can see for itself (mentions, floods, names).
CREATE TABLE IF NOT EXISTS automod_rules (
  id BIGINT PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled BIGINT NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  actions TEXT NOT NULL DEFAULT '[]',
  exempt_roles TEXT NOT NULL DEFAULT '[]',
  exempt_channels TEXT NOT NULL DEFAULT '[]',
  creator_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS automod_rules_server ON automod_rules(server_id);

-- Each time a rule acted: on whom, where, what it did, and what was caught,
-- sealed with the server's key so only its members' apps can read it.
CREATE TABLE IF NOT EXISTS automod_events (
  id BIGINT PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  rule_id BIGINT,
  rule_name TEXT NOT NULL DEFAULT '',
  rule_kind TEXT NOT NULL DEFAULT '',
  user_id BIGINT NOT NULL,
  channel_id BIGINT,
  -- the message it was about, when that was sent (an alert, or one cleared away)
  message_id BIGINT,
  actions TEXT NOT NULL DEFAULT '[]',
  content TEXT,
  reporter_id BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS automod_events_server ON automod_events(server_id, id);
CREATE INDEX IF NOT EXISTS automod_events_user ON automod_events(server_id, user_id);
CREATE INDEX IF NOT EXISTS automod_events_message ON automod_events(message_id) WHERE message_id IS NOT NULL;

-- The audit log can be read by what was done and by whom.
CREATE INDEX IF NOT EXISTS audit_log_action ON audit_log(server_id, action, id);
CREATE INDEX IF NOT EXISTS audit_log_actor ON audit_log(server_id, actor_id, id);

-- New permissions, given so nothing anyone could do before stops working:
-- @everyone keeps using emoji and stickers from elsewhere and gains threads
-- (where it can send messages); whoever could pin with Manage Messages still
-- can, now that pinning is its own permission.
UPDATE roles SET permissions = permissions | 262144 | 137438953472 WHERE id = server_id;
UPDATE roles SET permissions = permissions | 34359738368 | 68719476736 | 274877906944 WHERE id = server_id AND (permissions & 2048) != 0;
UPDATE roles SET permissions = permissions | 2251799813685248 WHERE (permissions & 8192) != 0;
-- A channel overwrite that kept people from sending keeps them out of its
-- threads as well, one that let them send lets them into threads, and one
-- about Manage Messages says the same about pinning.
UPDATE channel_overwrites SET deny = deny | 34359738368 | 68719476736 | 274877906944 WHERE (deny & 2048) != 0;
UPDATE channel_overwrites SET allow = allow | 34359738368 | 68719476736 | 274877906944 WHERE (allow & 2048) != 0;
UPDATE channel_overwrites SET allow = allow | 2251799813685248 WHERE (allow & 8192) != 0;
UPDATE channel_overwrites SET deny = deny | 2251799813685248 WHERE (deny & 8192) != 0;
