-- Incoming webhooks: a secret URL that posts into one server channel. Whatever
-- arrives through one was written by whoever holds the URL and reached this
-- server readable, so it is kept as it came (messages.plain) rather than
-- end-to-end encrypted, and the app says so on every such message.
CREATE TABLE webhooks (
  id BIGINT PRIMARY KEY,
  type BIGINT NOT NULL DEFAULT 1,          -- 1 incoming
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id BIGINT,                       -- who made it; kept when they leave
  name TEXT NOT NULL,
  avatar_id BIGINT REFERENCES blobs(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,                 -- SHA-256 of the URL's token, hex
  token_sealed BYTEA NOT NULL,               -- the token itself, sealed with the server secret
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX webhooks_server ON webhooks(server_id);
CREATE INDEX webhooks_channel ON webhooks(channel_id);

-- A webhook's message names the webhook that sent it and holds what it said,
-- as JSON, in place of a ciphertext. Deleting the webhook leaves its messages.
ALTER TABLE messages ADD COLUMN webhook_id BIGINT;
ALTER TABLE messages ADD COLUMN plain TEXT;

-- A poll's answers carry ids from 1 (poll_votes.option_index holds the id),
-- and a poll that has run out is closed once, when its result is posted.
ALTER TABLE polls ADD COLUMN ended_at BIGINT;
