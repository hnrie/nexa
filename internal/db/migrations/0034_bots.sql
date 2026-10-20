-- Applications and their bots: programs that speak the bot protocol of the
-- libraries made for Discord (internal/botproto, internal/api/bot_*.go). An
-- application's id is its bot's account id; the bot is an account with flag
-- 64, which nobody signs in to. Flag 128 on that account says the
-- application has the Message Content intent, which entitles the bot to the
-- keys of the servers it is in: the server then decrypts what it can see, to
-- hand it to the bot. Without it, a bot reads only what people address to it,
-- through copies their apps seal to the bot's key (bot_copies).
CREATE TABLE applications (
  id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  cover_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',               -- JSON list of up to five words
  terms_url TEXT NOT NULL DEFAULT '',
  privacy_url TEXT NOT NULL DEFAULT '',
  interactions_url TEXT NOT NULL DEFAULT '',     -- where interactions are posted instead of the gateway
  role_connections_url TEXT NOT NULL DEFAULT '',
  custom_install_url TEXT NOT NULL DEFAULT '',
  install_params TEXT,                           -- JSON {scopes, permissions} of the default server install
  integration_types TEXT NOT NULL DEFAULT '{"0":{}}', -- JSON: which installs are offered, each with its defaults
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  flags INTEGER NOT NULL DEFAULT 0,              -- application flags: the privileged intents switched on
  bot_public INTEGER NOT NULL DEFAULT 1,         -- anyone may add the bot, not only its owner
  bot_require_code_grant INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL DEFAULT '',           -- SHA-256 of the bot's token, hex; '' until one is made
  secret_hash TEXT NOT NULL DEFAULT '',          -- SHA-256 of the OAuth2 client secret, hex
  verify_key TEXT NOT NULL,                      -- the Ed25519 key interactions posted to interactions_url are signed with, hex
  sign_key_sealed BLOB NOT NULL,                 -- its private half, sealed with the server secret
  bot_key_sealed BLOB NOT NULL,                  -- the bot's X25519 private key, sealed with the server secret
  event_webhooks_url TEXT NOT NULL DEFAULT '',
  event_webhooks_status INTEGER NOT NULL DEFAULT 1, -- 1 off, 2 on
  event_webhooks_types TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX applications_owner ON applications(owner_id);
CREATE UNIQUE INDEX applications_token ON applications(token_hash) WHERE token_hash != '';

-- Emoji an application uploads for its own messages. Like every custom emoji
-- they are known by their picture's blob id, which is what message text
-- writes (<:name:blob>).
CREATE TABLE application_emojis (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  animated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (application_id, name)
);
CREATE INDEX application_emojis_blob ON application_emojis(blob_id);

-- The commands an application offers: everywhere (guild_id NULL) or in one
-- server. data is the rest of the command as the bot defined it.
CREATE TABLE application_commands (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  guild_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  type INTEGER NOT NULL DEFAULT 1,               -- 1 slash, 2 user, 3 message, 4 entry point
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX application_commands_global ON application_commands(application_id, type, name) WHERE guild_id IS NULL;
CREATE UNIQUE INDEX application_commands_guild ON application_commands(application_id, guild_id, type, name) WHERE guild_id IS NOT NULL;
CREATE INDEX application_commands_server ON application_commands(guild_id);

-- Who may use an application's commands in a server, as its managers set it:
-- for one command, or (command_id = the application's id) for all of them.
CREATE TABLE application_command_permissions (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  guild_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  command_id INTEGER NOT NULL,
  permissions TEXT NOT NULL,                     -- JSON [{id, type, permission}]
  PRIMARY KEY (application_id, guild_id, command_id)
);

-- Where an application is installed: in a server, by someone who manages it,
-- and on accounts, whose owners can then use its commands anywhere.
CREATE TABLE application_guild_installs (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  guild_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  installed_by INTEGER,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (application_id, guild_id)
);
CREATE INDEX application_guild_installs_guild ON application_guild_installs(guild_id);

CREATE TABLE application_user_installs (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (application_id, user_id)
);
CREATE INDEX application_user_installs_user ON application_user_installs(user_id);

-- OAuth2: codes handed back to an application's redirect, and the tokens they
-- are exchanged for. Only hashes are kept.
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  redirect_uri TEXT NOT NULL DEFAULT '',
  guild_id INTEGER,                              -- the server a bot was added to with this code
  permissions INTEGER NOT NULL DEFAULT 0,
  challenge TEXT NOT NULL DEFAULT '',            -- PKCE code_challenge
  challenge_method TEXT NOT NULL DEFAULT '',
  webhook_id INTEGER,                                -- the webhook made for webhook.incoming, handed over with the token
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_codes_expiry ON oauth_codes(expires_at);

CREATE TABLE oauth_tokens (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,                     -- when the access token stops working
  refresh_expires_at INTEGER NOT NULL,             -- when the refresh token does, and the row goes
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_user ON oauth_tokens(user_id, application_id);
CREATE INDEX oauth_tokens_expiry ON oauth_tokens(refresh_expires_at);

-- An interaction: someone using a command, a button or a form an application
-- made. It lives fifteen minutes, its token's lifetime, during which the
-- application answers it and follows up.
CREATE TABLE interactions (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  guild_id INTEGER,
  channel_id INTEGER,
  message_id INTEGER,                            -- the message a component sits on
  response_type INTEGER NOT NULL DEFAULT 0,      -- 0 until the application answers
  response_message_id INTEGER,                   -- the message its answer made (@original)
  ephemeral INTEGER NOT NULL DEFAULT 0,          -- whether that message is the invoker's alone
  data TEXT NOT NULL,                            -- the interaction as the application was sent it
  modal TEXT NOT NULL DEFAULT '',                -- the form its answer opened, which a submission is checked against
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX interactions_expiry ON interactions(expires_at);

-- Messages only one person sees: an application's answer marked ephemeral.
-- Nothing else lists them, and they go when the interaction's token does.
CREATE TABLE ephemeral_messages (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  interaction_id INTEGER,
  plain TEXT NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ephemeral_messages_user ON ephemeral_messages(user_id, channel_id);
CREATE INDEX ephemeral_messages_expiry ON ephemeral_messages(expires_at);

-- Files someone sends an application with an interaction (a command's file
-- option, a form's file field), kept as they came: interactions are not
-- end-to-end encrypted. They go a day later, as their blobs do.
CREATE TABLE interaction_files (
  blob_id INTEGER PRIMARY KEY REFERENCES blobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX interaction_files_created ON interaction_files(created_at);

-- The files an ephemeral message carries, which only its one person may
-- fetch. id is the attachment's id as the message names it.
CREATE TABLE ephemeral_files (
  id INTEGER PRIMARY KEY,
  ephemeral_id INTEGER NOT NULL REFERENCES ephemeral_messages(id) ON DELETE CASCADE,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  user_id INTEGER NOT NULL
);
CREATE INDEX ephemeral_files_blob ON ephemeral_files(blob_id);
CREATE INDEX ephemeral_files_message ON ephemeral_files(ephemeral_id);

-- A message's copy for a bot it is addressed to (a direct message, a mention,
-- a reply, a message command), sealed by the sender's app to the bot's key.
-- The server opens it with the bot's key to hand the bot the words.
CREATE TABLE bot_copies (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  bot_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sealed BLOB NOT NULL,
  PRIMARY KEY (message_id, bot_id)
);
CREATE INDEX bot_copies_bot ON bot_copies(bot_id);

-- A role a bot brought with it when it was added, holding the permissions it
-- asked for: nobody else can be given it, and it goes when the bot does.
ALTER TABLE roles ADD COLUMN managed_by INTEGER;

-- Using the commands of a server's applications, and having what one's own
-- applications answer seen by everyone, are permissions every member had
-- until now: @everyone keeps them.
UPDATE roles SET permissions = permissions | 2147483648 | 1125899906842624 WHERE id = server_id;
