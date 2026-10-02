-- The sound files of an account's sound packs: recordings someone picked to
-- play for a new message, a call and the rest. Each is sealed on the device
-- like any attachment (blob kind 'attachment', its key kept inside the
-- account's encrypted settings with the packs themselves), so the server
-- holds bytes it cannot play. A row is a reference on its blob, given back
-- when the sound is removed or the account is deleted.
CREATE TABLE IF NOT EXISTS user_sounds (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_id BIGINT NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, blob_id)
);
CREATE INDEX IF NOT EXISTS user_sounds_blob ON user_sounds(blob_id);
