package store

import (
	"context"
	"database/sql"
	"errors"
)

// AddRealtimeUsage adds to a month's estimated call egress and returns the new total.
func (s *Store) AddRealtimeUsage(ctx context.Context, month string, bytes int64) (int64, error) {
	var total int64
	err := s.db.W.QueryRowContext(ctx, `INSERT INTO realtime_usage (month, bytes, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(month) DO UPDATE SET bytes = realtime_usage.bytes + excluded.bytes, updated_at = excluded.updated_at
		RETURNING bytes`, month, bytes, nowMs()).Scan(&total)
	return total, err
}

// RealtimeUsage returns a month's estimated call egress.
func (s *Store) RealtimeUsage(ctx context.Context, month string) (int64, error) {
	var total int64
	err := s.db.R.QueryRowContext(ctx, `SELECT bytes FROM realtime_usage WHERE month = ?`, month).Scan(&total)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return total, err
}
