-- Closing a DM hides it from your sidebar until it has something new in it.
ALTER TABLE dm_participants ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- Invites grow beyond servers: a group DM can hand out a join link too, so
-- server_id becomes optional and channel_id carries the group.
CREATE TABLE invites_new (
  code TEXT PRIMARY KEY,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  channel_id INTEGER,
  inviter_id INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
INSERT INTO invites_new (code, server_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at)
  SELECT code, server_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_server ON invites(server_id);
CREATE INDEX invites_channel ON invites(channel_id);

-- Expression packs carry emoji as well as stickers, so a user can build and
-- share an emoji pack the same way they share stickers.
ALTER TABLE sticker_packs ADD COLUMN kind TEXT NOT NULL DEFAULT 'sticker';
CREATE INDEX sticker_packs_kind ON sticker_packs(kind, public, updated_at DESC);
