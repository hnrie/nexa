-- A subchat can carry a password. What is stored is the same shape as an
-- account's: a salt and parameters the client stretches the password with, and
-- an argon2id hash of what comes out, so the password itself never reaches
-- here. The messages stay encrypted with the conversation's keys either way;
-- the password is what keeps the subchat shut on the screen.
ALTER TABLE channels ADD COLUMN lock_salt BLOB;
ALTER TABLE channels ADD COLUMN lock_params TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN lock_hash TEXT NOT NULL DEFAULT '';

-- Which sessions have typed the password. Changing or removing it clears the
-- lot, and signing out takes a session's unlocks with it.
CREATE TABLE IF NOT EXISTS channel_unlocks (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, session_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_channel_unlocks_session ON channel_unlocks(session_id);
