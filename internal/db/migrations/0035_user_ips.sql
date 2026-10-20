-- The addresses each account has signed in or been active from, kept for
-- security: the staff's panel finds accounts that share one (alt accounts).
-- A row is written at sign-in and refreshed while a session is used from that
-- address, so last_seen_at says when the account was last there. Rows go
-- with the account.
CREATE TABLE user_ips (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ip)
);
CREATE INDEX user_ips_ip ON user_ips(ip);

-- what the sessions already knew
INSERT INTO user_ips (user_id, ip, first_seen_at, last_seen_at)
  SELECT user_id, ip, min(created_at), max(last_seen_at) FROM sessions WHERE ip != '' GROUP BY user_id, ip;
