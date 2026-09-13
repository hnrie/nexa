-- Resumable uploads. A file larger than one request can carry arrives in
-- pieces: the row tracks how much has landed, the bytes go to a spool file,
-- and finishing turns it into an ordinary blob.
CREATE TABLE uploads (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size       INTEGER NOT NULL,   -- what the client said it would send
  received   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX uploads_stale ON uploads(updated_at);
