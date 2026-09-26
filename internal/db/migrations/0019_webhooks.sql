-- Incoming webhooks: a secret URL that posts into one server channel. Whatever
-- arrives through one was written by whoever holds the URL and reached this
-- server readable, so it is kept as it came (messages.plain) rather than
-- end-to-end encrypted, and the app says so on every such message.
CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY,
  type INTEGER NOT NULL DEFAULT 1,          -- 1 incoming
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id INTEGER,                       -- who made it; kept when they leave
  name TEXT NOT NULL,
  avatar_id INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,                 -- SHA-256 of the URL's token, hex
  token_sealed BLOB NOT NULL,               -- the token itself, sealed with the server secret
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX webhooks_server ON webhooks(server_id);
CREATE INDEX webhooks_channel ON webhooks(channel_id);

-- A webhook's message names the webhook that sent it and holds what it said,
-- as JSON, in place of a ciphertext. Deleting the webhook leaves its messages.
ALTER TABLE messages ADD COLUMN webhook_id INTEGER;
ALTER TABLE messages ADD COLUMN plain TEXT;

-- A poll's answers carry ids from 1 (poll_votes.option_index holds the id),
-- and a poll that has run out is closed once, when its result is posted.
ALTER TABLE polls ADD COLUMN ended_at INTEGER;
