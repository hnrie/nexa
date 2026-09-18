package store

import (
	"context"
	"database/sql"

	"evilion.xyz/chat/internal/ids"
)

// ClientError is one crash reported by a browser.
type ClientError struct {
	ID        ids.ID  `json:"id"`
	UserID    *ids.ID `json:"user_id"`
	Kind      string  `json:"kind"`
	Message   string  `json:"message"`
	Stack     string  `json:"stack"`
	Component string  `json:"component"`
	Path      string  `json:"path"`
	UserAgent string  `json:"user_agent"`
	Version   string  `json:"version"`
	CreatedAt int64   `json:"created_at"`
}

// KeepClientErrors is how many reports are kept; older ones are dropped as new
// ones arrive, so this never grows without bound.
const KeepClientErrors = 500

// trimSlack is how far over the cap the log is allowed to run before it is
// trimmed. The trim is a full scan of the table, and the endpoint that drives
// it is the one most likely to be hit in a tight loop — a render error that
// re-renders and crashes again — so running it on every insert put up to a
// couple of thousand scan-and-delete statements a minute through SQLite's
// single writer connection, starving every real write on the instance. Every
// fiftieth report is enough to keep the table bounded.
const trimSlack = 50

// RecordClientError stores one report and trims the oldest beyond the cap.
func (s *Store) RecordClientError(ctx context.Context, e *ClientError) error {
	if e.ID.IsZero() {
		e.ID = ids.New()
	}
	if e.CreatedAt == 0 {
		e.CreatedAt = nowMs()
	}
	if _, err := s.db.W.ExecContext(ctx, `INSERT INTO client_errors (id, user_id, kind, message, stack, component, path, user_agent, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
		int64(e.ID), nullID(e.UserID), e.Kind, e.Message, e.Stack, e.Component, e.Path, e.UserAgent, e.Version, e.CreatedAt); err != nil {
		return err
	}
	var n int
	if err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM client_errors`).Scan(&n); err != nil {
		// the report is stored either way; the table is trimmed next time
		return nil
	}
	if n <= KeepClientErrors+trimSlack {
		return nil
	}
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM client_errors WHERE id NOT IN (SELECT id FROM client_errors ORDER BY id DESC LIMIT ?)`, KeepClientErrors)
	return err
}

// RecentClientErrors returns the newest reports first.
func (s *Store) RecentClientErrors(ctx context.Context, limit int) ([]*ClientError, error) {
	if limit <= 0 || limit > KeepClientErrors {
		limit = 100
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, user_id, kind, message, stack, component, path, user_agent, version, created_at FROM client_errors ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ClientError{}
	for rows.Next() {
		var e ClientError
		var uid sql.NullInt64
		if err := rows.Scan(&e.ID, &uid, &e.Kind, &e.Message, &e.Stack, &e.Component, &e.Path, &e.UserAgent, &e.Version, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.UserID = idPtr(uid)
		out = append(out, &e)
	}
	return out, rows.Err()
}

// ClearClientErrors empties the log.
func (s *Store) ClearClientErrors(ctx context.Context) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM client_errors`)
	return err
}
