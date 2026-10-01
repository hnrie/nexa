-- Pictures and recordings in a moderation case's thread. Staff and the member
-- a case is about can both send them: a screenshot of what was reported, the
-- profile as it was. The files are blobs of kind 'case', which nothing public
-- serves: only the case's member and the staff can fetch them, through
-- /media/cases/{id}. Like the rest of a case they are not end-to-end
-- encrypted, and the app says so where they are added.
CREATE TABLE IF NOT EXISTS mod_message_files (
  message_id INTEGER NOT NULL REFERENCES mod_messages(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES mod_cases(id) ON DELETE CASCADE,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',                 -- the file's own name, when it had one
  PRIMARY KEY (message_id, blob_id)
);
CREATE INDEX IF NOT EXISTS mod_message_files_case ON mod_message_files(case_id, message_id);
CREATE INDEX IF NOT EXISTS mod_message_files_blob ON mod_message_files(blob_id);
