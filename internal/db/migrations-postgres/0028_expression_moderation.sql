-- Stickers and emoji in the moderation panel (internal/api/
-- moderation_expressions.go). A picture the staff take down is blocked by its
-- hash: no copy of it is served any longer, even where another pack or
-- server still names it, and nobody can upload it again as anything.
CREATE TABLE IF NOT EXISTS blocked_images (
  sha256 TEXT PRIMARY KEY,
  case_id BIGINT,
  created_at BIGINT NOT NULL
);
ALTER TABLE blobs ADD COLUMN IF NOT EXISTS blocked BIGINT NOT NULL DEFAULT 0;
-- A pack the staff took out of Discover stays out until they let it back.
ALTER TABLE sticker_packs ADD COLUMN IF NOT EXISTS discover_blocked BIGINT NOT NULL DEFAULT 0;
-- the newest stickers and emoji first, for the staff's look at new uploads
CREATE INDEX IF NOT EXISTS stickers_created ON stickers(created_at);
CREATE INDEX IF NOT EXISTS emojis_created ON emojis(created_at);
