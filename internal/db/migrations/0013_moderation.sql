-- Instance moderation, delivered through Nexa, the system account: the actions
-- staff take against accounts, the conversation about each one, the mutes and
-- bans in force, announcements, and a log of everything staff did that can
-- only ever be added to.
--
-- None of this is end-to-end encrypted, and it cannot be: a case thread is a
-- conversation between a member and the instance's own staff, and both sides
-- have to be able to read it. The app says so wherever one is written.

-- One row per action a moderator took against an account. A case is also the
-- thread about that action, where the member can appeal or ask questions.
CREATE TABLE IF NOT EXISTS mod_cases (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,              -- #1, #2, … as people refer to it
  user_id INTEGER NOT NULL,                    -- the account acted on; no foreign key, the record outlives it
  moderator_id INTEGER NOT NULL,
  action TEXT NOT NULL,                        -- avatar_remove | field_reset | mute | ban | delete
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',          -- JSON: exactly what was done (fields and values, duration)
  target_username TEXT NOT NULL,               -- the account as it was when it was acted on
  target_display_name TEXT NOT NULL,
  expires_at INTEGER,                          -- when a mute or ban runs out; NULL when permanent or not timed
  lifted_at INTEGER,                           -- a mute or ban a moderator ended early
  lifted_by INTEGER,
  lift_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',         -- open | closed
  closed_at INTEGER,
  closed_by INTEGER,
  awaiting TEXT NOT NULL DEFAULT 'none',       -- who the thread is waiting on: staff | member | none
  last_activity_at INTEGER NOT NULL,
  member_read_id INTEGER NOT NULL DEFAULT 0,   -- the newest thread message the member has seen
  notice_ack_at INTEGER,                       -- when the member dismissed the notice; until then it pops up again
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_cases_user ON mod_cases(user_id, id DESC);
CREATE INDEX IF NOT EXISTS mod_cases_activity ON mod_cases(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS mod_cases_awaiting ON mod_cases(awaiting, last_activity_at DESC);

-- A case's thread. The member writes as themselves; staff write as Nexa, and
-- which of them it was is kept and shown. System lines record what happened
-- to the case (lifted, closed, reopened, ran out), named by `event`.
CREATE TABLE IF NOT EXISTS mod_messages (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES mod_cases(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                          -- member | staff | system
  event TEXT NOT NULL DEFAULT '',              -- for system lines: lifted | closed | reopened | expired | replaced
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_messages_case ON mod_messages(case_id, id);

-- The mutes and bans in force: at most one of each per account, pointing at
-- the case that imposed it. A row whose time has passed is no longer in force
-- from that moment; a sweeper removes it and tells the member.
CREATE TABLE IF NOT EXISTS mod_restrictions (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                          -- mute | ban
  case_id INTEGER NOT NULL,
  expires_at INTEGER,                          -- NULL: until a moderator lifts it
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX IF NOT EXISTS mod_restrictions_expiry ON mod_restrictions(expires_at);

-- Messages staff sent to everyone through Nexa. Each shows who wrote it.
CREATE TABLE IF NOT EXISTS mod_announcements (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Everything staff did, as it was done, with the names as they were then.
-- Rows are only ever added: the triggers refuse any change or removal, so the
-- record cannot be rewritten afterwards by this program or at the database.
CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  moderator_id INTEGER NOT NULL,
  moderator_username TEXT NOT NULL,
  target_id INTEGER,
  target_username TEXT NOT NULL DEFAULT '',
  case_id INTEGER,
  case_number INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_log_target ON mod_log(target_id, id DESC);
CREATE INDEX IF NOT EXISTS mod_log_moderator ON mod_log(moderator_id, id DESC);
CREATE INDEX IF NOT EXISTS mod_log_action ON mod_log(action, id DESC);
CREATE TRIGGER IF NOT EXISTS mod_log_no_update BEFORE UPDATE ON mod_log BEGIN SELECT RAISE(ABORT, 'mod_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS mod_log_no_delete BEFORE DELETE ON mod_log BEGIN SELECT RAISE(ABORT, 'mod_log is append-only'); END;

-- Usernames a moderator reset. The old name stays with its account as a way
-- to sign in, so someone who missed the notice is not locked out of an account
-- whose name they no longer know, and nobody can take it: not a new account,
-- and not the same one back.
CREATE TABLE IF NOT EXISTS username_holds (
  username TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS username_holds_user ON username_holds(user_id);

-- How far each member has read what Nexa sent them.
CREATE TABLE IF NOT EXISTS nexa_reads (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL
);
