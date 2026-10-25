-- Passkeys (internal/api/passkey_handlers.go). public_key is the credential's
-- key as SubjectPublicKeyInfo DER, alg its COSE algorithm. enc_private_key is
-- the account's identity key wrapped by the app with a key only the passkey's
-- PRF output makes, so a passkey both signs in and opens the messages, and the
-- server can do neither with what it holds. rp_id is the address it was made on.
CREATE TABLE IF NOT EXISTS passkeys (
  id              BIGINT PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   BYTEA NOT NULL UNIQUE,
  public_key      BYTEA NOT NULL,
  alg             BIGINT NOT NULL,
  sign_count      BIGINT NOT NULL DEFAULT 0,
  rp_id           TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  enc_private_key BYTEA NOT NULL,
  created_at      BIGINT NOT NULL,
  last_used_at    BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
