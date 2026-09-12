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
