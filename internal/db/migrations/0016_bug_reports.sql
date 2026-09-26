-- Bug reports: what members send the Nexa team from the app, and the thread
-- with the team about each one, which the member reads in their Nexa
-- conversation next to their moderation cases.
--
-- They are kept apart from mod_cases on purpose. A case is an action taken
-- against an account, numbered in one gap-free series that the log and the
-- notices refer to, and a dozen queries rely on every case being one. A bug
-- report is the member's own message to the team, with a number series and a
-- set of states of its own.
--
-- None of this is end-to-end encrypted: the team has to read the report and
-- see its screenshots, and the form says so where it is written.

CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,               -- #1, #2, … as people refer to it
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_username TEXT NOT NULL,              -- the reporter as they were when they sent it
  reporter_display_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',           -- JSON the reporter chose to send: app, build, browser, system, screen, language
  status TEXT NOT NULL DEFAULT 'open',          -- open | in_progress | resolved | wont_fix | closed
  status_at INTEGER,                            -- when a member of staff last set the status, and who
  status_by INTEGER,
  awaiting TEXT NOT NULL DEFAULT 'staff',       -- who the thread is waiting on: staff | member | none
  attachment_count INTEGER NOT NULL DEFAULT 0,  -- how many files came with it, for the list's filter
  last_activity_at INTEGER NOT NULL,
  member_read_id INTEGER NOT NULL DEFAULT 0,    -- the newest thread line the reporter has seen
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_reports_user ON bug_reports(user_id, id DESC);
CREATE INDEX IF NOT EXISTS bug_reports_activity ON bug_reports(last_activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status ON bug_reports(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_awaiting ON bug_reports(awaiting, last_activity_at DESC);

-- The screenshots and recordings sent with a report. The files are ordinary
-- blobs of kind 'bug', which nothing public serves: only the reporter and the
-- staff can fetch them.
CREATE TABLE IF NOT EXISTS bug_attachments (
  report_id INTEGER NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  blob_id INTEGER NOT NULL REFERENCES blobs(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',                -- the file's own name, when it had one
  PRIMARY KEY (report_id, blob_id)
);
CREATE INDEX IF NOT EXISTS bug_attachments_blob ON bug_attachments(blob_id);

-- A report's thread. The reporter writes as themselves; staff write as Nexa,
-- and which of them it was is kept and shown. System lines record a change of
-- status, the new one in `body`.
CREATE TABLE IF NOT EXISTS bug_messages (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                           -- member | staff | system
  event TEXT NOT NULL DEFAULT '',               -- for system lines: status
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_messages_report ON bug_messages(report_id, id);
