package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// CreateSession inserts a session (ID/CreatedAt filled when zero).
func (s *Store) CreateSession(ctx context.Context, se *Session) error {
	if se.ID.IsZero() {
		se.ID = ids.New()
	}
	if se.CreatedAt == 0 {
		se.CreatedAt = nowMs()
	}
	if se.LastSeenAt == 0 {
		se.LastSeenAt = se.CreatedAt
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)`,
		int64(se.ID), int64(se.UserID), se.TokenHash, se.UserAgent, se.IP, se.CreatedAt, se.LastSeenAt)
	if err != nil {
		return err
	}
	return s.RecordUserIP(ctx, se.UserID, se.IP, se.LastSeenAt)
}

func scanSession(r rowScanner) (*Session, error) {
	var se Session
	if err := r.Scan(&se.ID, &se.UserID, &se.TokenHash, &se.UserAgent, &se.IP, &se.CreatedAt, &se.LastSeenAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &se, nil
}

// SessionByTokenHash finds the session for a hashed bearer token.
func (s *Store) SessionByTokenHash(ctx context.Context, hash string) (*Session, error) {
	return scanSession(s.db.R.QueryRowContext(ctx, `SELECT id, user_id, token_hash, user_agent, ip, created_at, last_seen_at FROM sessions WHERE token_hash = ?`, hash))
}

// SessionByID loads a session.
func (s *Store) SessionByID(ctx context.Context, id ids.ID) (*Session, error) {
	return scanSession(s.db.R.QueryRowContext(ctx, `SELECT id, user_id, token_hash, user_agent, ip, created_at, last_seen_at FROM sessions WHERE id = ?`, int64(id)))
}

// TouchSession records activity on se from ip ("" when not known), keeping
// the session's address and the account's addresses up to date.
func (s *Store) TouchSession(ctx context.Context, se *Session, ip string, lastSeen int64) error {
	if ip == "" {
		ip = se.IP
	}
	if _, err := s.db.W.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?`, lastSeen, ip, int64(se.ID)); err != nil {
		return err
	}
	return s.RecordUserIP(ctx, se.UserID, ip, lastSeen)
}

// DeleteSession removes one session.
func (s *Store) DeleteSession(ctx context.Context, id ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUserSessions removes every session of a user except exceptID (0 = all).
func (s *Store) DeleteUserSessions(ctx context.Context, userID, exceptID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND id != ?`, int64(userID), int64(exceptID))
	return err
}

// DeleteExpiredSessions removes sessions idle since before cutoff.
func (s *Store) DeleteExpiredSessions(ctx context.Context, cutoff int64) (int64, error) {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM sessions WHERE last_seen_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// SessionsByUser lists a user's sessions, newest first.
func (s *Store) SessionsByUser(ctx context.Context, userID ids.ID) ([]*Session, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, user_id, token_hash, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`, int64(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Session
	for rows.Next() {
		se, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, se)
	}
	return out, rows.Err()
}
