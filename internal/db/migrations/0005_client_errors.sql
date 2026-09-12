-- Crashes reported by the web app, so a broken build shows up here rather than
-- only in whoever hit it. No message content is ever sent: a report carries the
-- error, where in the code it came from, and which build it was.
CREATE TABLE client_errors (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'error',   -- error | render | promise
  message    TEXT NOT NULL,
  stack      TEXT NOT NULL DEFAULT '',
  component  TEXT NOT NULL DEFAULT '',
  path       TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  version    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX client_errors_time ON client_errors(created_at DESC);
