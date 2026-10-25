-- Passkeys (internal/api/passkey_handlers.go). public_key is the credential's
-- key as SubjectPublicKeyInfo DER, alg its COSE algorithm. enc_private_key is
-- the account's identity key wrapped by the app with a key only the passkey's
-- PRF output makes, so a passkey both signs in and opens the messages, and the
-- server can do neither with what it holds. rp_id is the address it was made on.
CREATE TABLE passkeys (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   BLOB NOT NULL UNIQUE,
  public_key      BLOB NOT NULL,
  alg             INTEGER NOT NULL,
  sign_count      INTEGER NOT NULL DEFAULT 0,
  rp_id           TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  enc_private_key BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX passkeys_user ON passkeys(user_id);
