-- A file uploaded for a note that no save has named yet. A note written
-- together shows a picture to everyone in it the moment it is added, before
-- the next save makes the file the note's (note_files), so the note's people
-- may download it from here, and any of them may save the note with it in.
-- An upload no save ever names is swept away like any other, and its row
-- goes with it.
CREATE TABLE IF NOT EXISTS note_uploads (
  blob_id INTEGER PRIMARY KEY REFERENCES blobs(id) ON DELETE CASCADE,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS note_uploads_note ON note_uploads(note_id);
