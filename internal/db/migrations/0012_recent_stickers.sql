-- Recently used stickers, per account, so the picker can offer the last ones
-- first on every device. One row per account and sticker, refreshed on each
-- send; only the newest MaxRecentStickers are kept. The sticker row carries
-- the picture, so this table holds ids alone. Deleting a sticker takes its
-- rows with it.
CREATE TABLE IF NOT EXISTS recent_stickers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sticker_id INTEGER NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, sticker_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_recent_stickers_user ON recent_stickers(user_id, used_at DESC);
