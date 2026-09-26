-- Bug reports: what members send the Nexa team from the app, and the thread
-- with the team about each one. The SQLite migration of the same number
-- explains the tables; this is the same schema in Postgres's types.

CREATE TABLE IF NOT EXISTS bug_reports (
  id BIGINT PRIMARY KEY,
  number BIGINT NOT NULL UNIQUE,                -- #1, #2, … as people refer to it
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_username TEXT NOT NULL,              -- the reporter as they were when they sent it
  reporter_display_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',           -- JSON the reporter chose to send: app, build, browser, system, screen, language
  status TEXT NOT NULL DEFAULT 'open',          -- open | in_progress | resolved | wont_fix | closed
  status_at BIGINT,                             -- when a member of staff last set the status, and who
  status_by BIGINT,
  awaiting TEXT NOT NULL DEFAULT 'staff',       -- who the thread is waiting on: staff | member | none
  attachment_count BIGINT NOT NULL DEFAULT 0,   -- how many files came with it, for the list's filter
  last_activity_at BIGINT NOT NULL,
  member_read_id BIGINT NOT NULL DEFAULT 0,     -- the newest thread line the reporter has seen
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_reports_user ON bug_reports(user_id, id DESC);
CREATE INDEX IF NOT EXISTS bug_reports_activity ON bug_reports(last_activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status ON bug_reports(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_awaiting ON bug_reports(awaiting, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS bug_attachments (
  report_id BIGINT NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  blob_id BIGINT NOT NULL REFERENCES blobs(id),
  position BIGINT NOT NULL,
  name TEXT NOT NULL DEFAULT '',                -- the file's own name, when it had one
  PRIMARY KEY (report_id, blob_id)
);
CREATE INDEX IF NOT EXISTS bug_attachments_blob ON bug_attachments(blob_id);

CREATE TABLE IF NOT EXISTS bug_messages (
  id BIGINT PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                           -- member | staff | system
  event TEXT NOT NULL DEFAULT '',               -- for system lines: status
  body TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_messages_report ON bug_messages(report_id, id);
