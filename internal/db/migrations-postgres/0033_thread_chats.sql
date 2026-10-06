-- Case threads and bug reports work as conversations (internal/api/nexa.go,
-- bugs.go). A bug report's thread takes pictures and recordings after the
-- report itself, as a case's does (0024): blobs of kind 'bug', which nothing
-- public serves; only the reporter and the staff can fetch them, through
-- /media/bugs/{id}.
CREATE TABLE IF NOT EXISTS bug_message_files (
  message_id BIGINT NOT NULL REFERENCES bug_messages(id) ON DELETE CASCADE,
  report_id BIGINT NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  blob_id BIGINT NOT NULL REFERENCES blobs(id),
  position BIGINT NOT NULL,
  name TEXT NOT NULL DEFAULT '',                 -- the file's own name, when it had one
  PRIMARY KEY (message_id, blob_id)
);
CREATE INDEX IF NOT EXISTS bug_message_files_report ON bug_message_files(report_id, message_id);
CREATE INDEX IF NOT EXISTS bug_message_files_blob ON bug_message_files(blob_id);

-- What each member of staff has read of the case threads and bug reports, so
-- the panel's badges count what is new to them and can be marked read. A row
-- of kind 'all' (item_id 0) reads everything up to its read_id at once.
CREATE TABLE IF NOT EXISTS mod_reads (
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                            -- case | bug | all
  item_id BIGINT NOT NULL,
  read_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
);
