-- Subscriptions (internal/api/billing.go). users.plan is the plan an account
-- has now ('' free, 'supporter', 'pro'), public like a badge, and what every
-- limit reads. billing is what Stripe said last about that account's
-- subscription; the webhook writes both together. A server's boosts are the
-- Pro accounts boosting it, counted in servers.boosts for everyone's apps.
-- plan_gifts are plans someone bought for someone else, one Checkout session
-- each: the account wears the better of its own subscription and a gift
-- still running.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS boosts BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS billing (
  user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  customer_id     TEXT NOT NULL DEFAULT '',
  subscription_id TEXT NOT NULL DEFAULT '',
  plan            TEXT NOT NULL DEFAULT '',
  period          TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT '',
  period_end      BIGINT NOT NULL DEFAULT 0,
  cancel_at_end   BIGINT NOT NULL DEFAULT 0,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_customer ON billing(customer_id);
CREATE TABLE IF NOT EXISTS server_boosts (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS server_boosts_user ON server_boosts(user_id);
CREATE INDEX IF NOT EXISTS server_boosts_server ON server_boosts(server_id);
CREATE TABLE IF NOT EXISTS plan_gifts (
  id         BIGINT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  from_id    BIGINT NOT NULL,
  to_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL,
  starts_at  BIGINT NOT NULL,
  ends_at    BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_gifts_to ON plan_gifts(to_id, ends_at);
