-- User-submitted safety reports. Evidence is deliberately shared with staff,
-- never a grant of access to the original encrypted conversation.
CREATE TABLE IF NOT EXISTS safety_reports (
 id BIGINT PRIMARY KEY,
 request_id TEXT NOT NULL,
 reporter_id BIGINT NOT NULL,
 target_kind TEXT NOT NULL,
 target_id BIGINT NOT NULL DEFAULT 0,
 subject_id BIGINT NOT NULL DEFAULT 0,
 server_id BIGINT NOT NULL DEFAULT 0,
 part TEXT NOT NULL,
 custom_part TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL,
 description TEXT NOT NULL,
 excerpt TEXT NOT NULL DEFAULT '',
 snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 assigned_to BIGINT NOT NULL DEFAULT 0,
 version BIGINT NOT NULL DEFAULT 1,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS safety_reports_request ON safety_reports(reporter_id, request_id);
CREATE INDEX IF NOT EXISTS safety_reports_queue ON safety_reports(status, id DESC);
CREATE INDEX IF NOT EXISTS safety_reports_reporter ON safety_reports(reporter_id, id DESC);
CREATE INDEX IF NOT EXISTS safety_reports_target ON safety_reports(target_kind, target_id);
CREATE TABLE IF NOT EXISTS safety_report_events (
 id BIGINT PRIMARY KEY,
 report_id BIGINT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL,
 status TEXT NOT NULL,
 assigned_to BIGINT NOT NULL DEFAULT 0,
 note TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS safety_report_events_report ON safety_report_events(report_id, id);
CREATE TABLE IF NOT EXISTS safety_report_files (
 report_id BIGINT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
 blob_id BIGINT NOT NULL REFERENCES blobs(id),
 name TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(report_id, blob_id)
);
CREATE INDEX IF NOT EXISTS safety_report_files_blob ON safety_report_files(blob_id);

CREATE TABLE IF NOT EXISTS safety_report_snapshot_blobs (
 report_id BIGINT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
 blob_id BIGINT NOT NULL REFERENCES blobs(id),
 PRIMARY KEY(report_id, blob_id)
);

CREATE INDEX IF NOT EXISTS safety_report_snapshot_blobs_blob ON safety_report_snapshot_blobs(blob_id);
