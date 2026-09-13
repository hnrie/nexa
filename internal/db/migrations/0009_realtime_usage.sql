-- How much media Cloudflare Realtime sent out for calls each month, estimated
-- from what was pulled and at what bitrate, so calls stay inside the free
-- allowance.
CREATE TABLE realtime_usage (
  month TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
