-- A Nexa account's link to a Discord account, for showing what the person is
-- doing on Discord (listening, playing, watching) as their activity here. The
-- link is made with Discord's OAuth, which also puts the Discord account in
-- the small Discord server Nexa's bot watches presence in. The tokens are kept
-- sealed with the server secret, only so the bot can add the person to that
-- server again after they leave it; unlinking deletes the row and them.
CREATE TABLE discord_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL DEFAULT '',
  global_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',          -- Discord's avatar hash, for the settings page
  access_sealed BLOB,                       -- OAuth access token, sealed with the server secret
  refresh_sealed BLOB,                      -- OAuth refresh token, sealed the same way
  token_expires_at INTEGER NOT NULL DEFAULT 0,
  in_guild INTEGER NOT NULL DEFAULT 0,      -- 1 while the Discord account is in the activity server
  left_at INTEGER NOT NULL DEFAULT 0,       -- when it was seen leaving it (0: it has not)
  show_activity INTEGER NOT NULL DEFAULT 1, -- whether what Discord says shows here at all
  kinds INTEGER NOT NULL DEFAULT 31,        -- which kinds show: 1 playing, 2 listening, 4 watching, 8 streaming, 16 competing
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
