-- Two-factor authentication: an authenticator app plus single-use backup codes.
-- The shared secret is sealed with the server secret before it is stored, so a
-- stolen database file does not hand over anybody's second factor.
CREATE TABLE user_mfa (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret BLOB NOT NULL,
  last_step   INTEGER NOT NULL DEFAULT 0,   -- newest counter already spent, so a code is single-use
  enabled     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE mfa_backup_codes (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,                  -- keyed hash, never the code itself
  used_at   INTEGER,
  PRIMARY KEY (user_id, code_hash)
);
