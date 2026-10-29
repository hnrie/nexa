package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

const ReportBlobKind = "report"

var ErrReportConflict = errors.New("report changed")

type SafetyReport struct {
	RequestID   string          `json:"-"`
	ID          ids.ID          `json:"id"`
	ReporterID  ids.ID          `json:"reporter_id"`
	TargetKind  string          `json:"target_kind"`
	TargetID    ids.ID          `json:"target_id"`
	SubjectID   ids.ID          `json:"subject_id"`
	ServerID    ids.ID          `json:"server_id"`
	Part        string          `json:"part"`
	CustomPart  string          `json:"custom_part"`
	Reason      string          `json:"reason"`
	Description string          `json:"description"`
	Excerpt     string          `json:"excerpt"`
	Snapshot    json.RawMessage `json:"snapshot"`
	Status      string          `json:"status"`
	AssignedTo  ids.ID          `json:"assigned_to"`
	Version     int             `json:"version"`
	CreatedAt   int64           `json:"created_at"`
	UpdatedAt   int64           `json:"updated_at"`
}

type SafetyReportEvent struct {
	ID         ids.ID `json:"id"`
	ReportID   ids.ID `json:"report_id"`
	ActorID    ids.ID `json:"actor_id"`
	Status     string `json:"status"`
	AssignedTo ids.ID `json:"assigned_to"`
	Note       string `json:"note"`
	CreatedAt  int64  `json:"created_at"`
}

const reportCols = `id, request_id, reporter_id, target_kind, target_id, subject_id, server_id, part, custom_part, reason, description, excerpt, snapshot, status, assigned_to, version, created_at, updated_at`

func scanSafetyReport(row rowScanner) (*SafetyReport, error) {
	var v SafetyReport
	var snap string
	err := row.Scan(&v.ID, &v.RequestID, &v.ReporterID, &v.TargetKind, &v.TargetID, &v.SubjectID, &v.ServerID, &v.Part, &v.CustomPart, &v.Reason, &v.Description, &v.Excerpt, &snap, &v.Status, &v.AssignedTo, &v.Version, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	v.Snapshot = json.RawMessage(snap)
	return &v, nil
}
func ValidReportStatus(s string) bool {
	return s == "open" || s == "in_review" || s == "actioned" || s == "dismissed"
}

func (s *Store) CreateSafetyReport(ctx context.Context, v *SafetyReport, files []BugAttachment) error {
	v.ID = ids.New()
	v.CreatedAt = nowMs()
	v.UpdatedAt = v.CreatedAt
	v.Version = 1
	v.Status = "open"
	return s.Tx(ctx, func(tx *db.Tx) error {
		if err := tx.Serialise(ctx, "report-request:"+v.ReporterID.String()); err != nil {
			return err
		}
		existing, err := scanSafetyReport(tx.QueryRowContext(ctx, `SELECT `+reportCols+` FROM safety_reports WHERE reporter_id=? AND request_id=?`, int64(v.ReporterID), v.RequestID))
		if err == nil {
			*v = *existing
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO safety_reports (`+reportCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, int64(v.ID), v.RequestID, int64(v.ReporterID), v.TargetKind, int64(v.TargetID), int64(v.SubjectID), int64(v.ServerID), v.Part, v.CustomPart, v.Reason, v.Description, v.Excerpt, string(v.Snapshot), v.Status, int64(v.AssignedTo), v.Version, v.CreatedAt, v.UpdatedAt); err != nil {
			return err
		}

		var snapshot any
		if err := json.Unmarshal(v.Snapshot, &snapshot); err != nil {
			return err
		}
		blobs := map[ids.ID]bool{}
		var collect func(any)
		collect = func(value any) {
			switch x := value.(type) {
			case map[string]any:
				for key, child := range x {
					if key == "avatar_id" || key == "banner_id" || key == "icon_id" || key == "blob_id" || key == "cover_blob_id" {
						if raw, ok := child.(string); ok {
							if id, err := ids.Parse(raw); err == nil {
								blobs[id] = true
							}
						}
					}
					collect(child)
				}
			case []any:
				for _, child := range x {
					collect(child)
				}
			}
		}
		collect(snapshot)
		for blob := range blobs {
			res, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count=ref_count+1 WHERE id=? AND encrypted=0 AND kind IN ('avatar','banner','icon','emoji','sticker','tag','widget','typing')`, int64(blob))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 1 {
				if _, err := tx.ExecContext(ctx, `INSERT INTO safety_report_snapshot_blobs (report_id,blob_id) VALUES (?,?)`, int64(v.ID), int64(blob)); err != nil {
					return err
				}
			}
		}
		for _, f := range files {
			res, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count=ref_count+1 WHERE id=? AND kind=? AND owner_id=? AND ref_count=0`, int64(f.BlobID), ReportBlobKind, int64(v.ReporterID))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n != 1 {
				return ErrBugAttachment
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO safety_report_files (report_id,blob_id,name) VALUES (?,?,?)`, int64(v.ID), int64(f.BlobID), f.Name); err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *Store) SafetyReportByID(ctx context.Context, id ids.ID) (*SafetyReport, error) {
	return scanSafetyReport(s.db.R.QueryRowContext(ctx, `SELECT `+reportCols+` FROM safety_reports WHERE id=?`, int64(id)))
}

type ReportFilter struct {
	Status, Kind, Query string
	Before              ids.ID
	Reporter            ids.ID
	Limit               int
	Assigned            ids.ID
}

func (s *Store) SafetyReports(ctx context.Context, f ReportFilter) ([]*SafetyReport, error) {
	where := []string{"1=1"}
	args := []any{}
	if f.Status == "active" {
		where = append(where, `status IN ('open','in_review')`)
	} else if f.Status != "" {
		where = append(where, `status=?`)
		args = append(args, f.Status)
	}
	if f.Kind != "" {
		where = append(where, `target_kind=?`)
		args = append(args, f.Kind)
	}
	if f.Before != 0 {
		where = append(where, `id<?`)
		args = append(args, int64(f.Before))
	}
	if f.Reporter != 0 {
		where = append(where, `reporter_id=?`)
		args = append(args, int64(f.Reporter))
	}
	if f.Assigned != 0 {
		where = append(where, `assigned_to=?`)
		args = append(args, int64(f.Assigned))
	}
	if f.Query != "" {
		where = append(where, `(lower(description) LIKE ? ESCAPE '\' OR lower(custom_part) LIKE ? ESCAPE '\' OR CAST(id AS TEXT)=? OR CAST(target_id AS TEXT)=?)`)
		q := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(f.Query)) + "%"
		args = append(args, q, q, f.Query, f.Query)
	}
	if f.Limit <= 0 || f.Limit > 101 {
		f.Limit = 51
	}
	args = append(args, f.Limit)
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+reportCols+` FROM safety_reports WHERE `+strings.Join(where, " AND ")+` ORDER BY id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*SafetyReport{}
	for rows.Next() {
		v, err := scanSafetyReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SafetyReportCounts(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT status,count(*) FROM safety_reports GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{"open": 0, "in_review": 0, "actioned": 0, "dismissed": 0}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}
func (s *Store) SafetyReportEvents(ctx context.Context, id ids.ID) ([]SafetyReportEvent, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id,report_id,actor_id,status,assigned_to,note,created_at FROM safety_report_events WHERE report_id=? ORDER BY id`, int64(id))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SafetyReportEvent{}
	for rows.Next() {
		var v SafetyReportEvent
		if err := rows.Scan(&v.ID, &v.ReportID, &v.ActorID, &v.Status, &v.AssignedTo, &v.Note, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// A compare-and-swap makes concurrent reviews fail explicitly instead of losing a decision.
func (s *Store) ReviewSafetyReport(ctx context.Context, id, actor ids.ID, version int, status, note string, assigned ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		at := nowMs()
		res, err := tx.ExecContext(ctx, `UPDATE safety_reports SET status=?,assigned_to=?,version=version+1,updated_at=? WHERE id=? AND version=?`, status, int64(assigned), at, int64(id), version)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return ErrReportConflict
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO safety_report_events (id,report_id,actor_id,status,assigned_to,note,created_at) VALUES (?,?,?,?,?,?,?)`, int64(ids.New()), int64(id), int64(actor), status, int64(assigned), note, at); err != nil {
			return err
		}
		return appendModLogTx(ctx, tx, &ModLogEntry{Action: "report_review", ModeratorID: actor, Reason: note, Details: json.RawMessage(mustReportJSON(map[string]any{"report_id": id, "status": status, "assigned_to": assigned}))})
	})
}
func mustReportJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func (s *Store) SafetyReportFiles(ctx context.Context, id ids.ID) ([]BugAttachment, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT b.id,f.name,b.mime,b.size,b.width,b.height FROM safety_report_files f JOIN blobs b ON b.id=f.blob_id WHERE f.report_id=? ORDER BY b.id`, int64(id))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BugAttachment{}
	for rows.Next() {
		var f BugAttachment
		var w, h sql.NullInt64
		if err := rows.Scan(&f.BlobID, &f.Name, &f.Mime, &f.Size, &w, &h); err != nil {
			return nil, err
		}
		if w.Valid {
			x := int(w.Int64)
			f.Width = &x
		}
		if h.Valid {
			x := int(h.Int64)
			f.Height = &x
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
func (s *Store) SafetyReportFileOwner(ctx context.Context, id ids.ID) (ids.ID, bool, error) {
	var owner ids.ID
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT b.owner_id,(SELECT count(*) FROM safety_report_files f WHERE f.blob_id=b.id) FROM blobs b WHERE b.id=? AND b.kind=?`, int64(id), ReportBlobKind).Scan(&owner, &n)
	return owner, n > 0, err
}

func (s *Store) SafetyReportByRequest(ctx context.Context, reporter ids.ID, request string) (*SafetyReport, error) {
	return scanSafetyReport(s.db.R.QueryRowContext(ctx, `SELECT `+reportCols+` FROM safety_reports WHERE reporter_id=? AND request_id=?`, int64(reporter), request))
}

// RemoveReportedMessage removes exactly the message in an existing report. It
// grants no channel access and records the case, log and report event atomically.
func (s *Store) RemoveReportedMessage(ctx context.Context, report *SafetyReport, version int, c *ModCase, log *ModLogEntry) (ids.ID, error) {
	var channel ids.ID
	err := s.Tx(ctx, func(tx *db.Tx) error {
		var target, author ids.ID
		var current int
		if err := tx.QueryRowContext(ctx, `SELECT target_id,version FROM safety_reports WHERE id=? AND target_kind='message'`, int64(report.ID)).Scan(&target, &current); err != nil {
			return ErrNotFound
		}
		if current != version {
			return ErrReportConflict
		}
		if err := tx.QueryRowContext(ctx, `SELECT channel_id,author_id FROM messages WHERE id=?`, int64(target)).Scan(&channel, &author); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if author != report.SubjectID {
			return ErrReportConflict
		}
		// Reserve this version before changing anything else. Losing the race rolls
		// the whole transaction back, including the message deletion and the case.
		res, err := tx.ExecContext(ctx, `UPDATE safety_reports SET version=version+1,updated_at=? WHERE id=? AND version=?`, nowMs(), int64(report.ID), version)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return ErrReportConflict
		}
		if err := deleteMessageTx(ctx, tx, target); err != nil {
			return err
		}
		if err := fixLastMessageTx(ctx, tx, channel); err != nil {
			return err
		}
		if err := openCaseTx(ctx, tx, c, log); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO safety_report_events (id,report_id,actor_id,status,assigned_to,note,created_at) VALUES (?,?,?,?,?,?,?)`, int64(ids.New()), int64(report.ID), int64(c.ModeratorID), report.Status, int64(report.AssignedTo), "#"+strconv.FormatInt(c.Number, 10)+": "+c.Reason, nowMs())
		return err
	})
	return channel, err
}

func (s *Store) SafetyReportSnapshotBlob(ctx context.Context, id ids.ID) (bool, error) {
	var count int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM safety_report_snapshot_blobs WHERE blob_id=?`, int64(id)).Scan(&count)
	return count > 0, err
}
