-- Guest links let someone without an account into one call: they give a
-- name, pass the captcha, and can do nothing but be in that call. The link's
-- fragment carries the call's key; the server only ever sees the code.
CREATE TABLE guest_links (
  code TEXT PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- the conversation key epoch whose call key the link carries
  epoch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX guest_links_channel ON guest_links(channel_id);

-- Someone in a call through a guest link. Guests are not accounts and never
-- appear among users, so nothing that lists, searches or signs in users can
-- reach one. Revoking the link removes its guests with it.
CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  link_code TEXT NOT NULL REFERENCES guest_links(code) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  session_id INTEGER NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX guests_link ON guests(link_code);
CREATE INDEX guests_channel ON guests(channel_id);
