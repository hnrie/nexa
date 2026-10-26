-- gift_links are plans bought as a link rather than for one person
-- (internal/api/billing.go): one Checkout session each, made once its payment
-- came in, and claimed once by whoever opens the link first. Claiming one
-- adds a plan_gifts row for the person who claimed it.
CREATE TABLE gift_links (
  code       TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  from_id    INTEGER NOT NULL,
  plan       TEXT NOT NULL,
  days       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_by INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX gift_links_from ON gift_links(from_id, created_at);
