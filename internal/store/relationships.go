package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// Relationships lists everything from uid's point of view.
func (s *Store) Relationships(ctx context.Context, uid ids.ID) ([]*Relationship, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id, target_id, type, nickname, created_at FROM relationships WHERE user_id = ? ORDER BY created_at`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Relationship{}
	for rows.Next() {
		var r Relationship
		if err := rows.Scan(&r.UserID, &r.TargetID, &r.Type, &r.Nickname, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

// Relationship returns the row uid → target, or ErrNotFound.
func (s *Store) Relationship(ctx context.Context, uid, target ids.ID) (*Relationship, error) {
	var r Relationship
	err := s.db.R.QueryRowContext(ctx, `SELECT user_id, target_id, type, nickname, created_at FROM relationships WHERE user_id = ? AND target_id = ?`, int64(uid), int64(target)).Scan(&r.UserID, &r.TargetID, &r.Type, &r.Nickname, &r.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SetRelationship upserts uid → target with the given type.
func (s *Store) SetRelationship(ctx context.Context, uid, target ids.ID, typ string) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO relationships (user_id, target_id, type, nickname, created_at) VALUES (?,?,?,'',?)
		ON CONFLICT(user_id, target_id) DO UPDATE SET type = excluded.type, created_at = excluded.created_at`, int64(uid), int64(target), typ, nowMs())
	return err
}

// SetRelationshipPair writes both directions atomically.
func (s *Store) SetRelationshipPair(ctx context.Context, a, b ids.ID, typeA, typeB string) error {
	now := nowMs()
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for _, p := range []struct {
			u, t ids.ID
			typ  string
		}{{a, b, typeA}, {b, a, typeB}} {
			if _, err := tx.ExecContext(ctx, `INSERT INTO relationships (user_id, target_id, type, nickname, created_at) VALUES (?,?,?,'',?)
				ON CONFLICT(user_id, target_id) DO UPDATE SET type = excluded.type, created_at = excluded.created_at`, int64(p.u), int64(p.t), p.typ, now); err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteRelationship removes uid → target.
func (s *Store) DeleteRelationship(ctx context.Context, uid, target ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM relationships WHERE user_id = ? AND target_id = ?`, int64(uid), int64(target))
	return err
}

// DeleteRelationshipPair removes both directions.
func (s *Store) DeleteRelationshipPair(ctx context.Context, a, b ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM relationships WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)`, int64(a), int64(b), int64(b), int64(a))
	return err
}

// AreFriends reports whether a and b are friends.
func (s *Store) AreFriends(ctx context.Context, a, b ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM relationships WHERE user_id = ? AND target_id = ? AND type = 'friend'`, int64(a), int64(b)).Scan(&n)
	return n > 0, err
}

// Blocked reports whether either side has blocked the other.
func (s *Store) Blocked(ctx context.Context, a, b ids.ID) (aBlockedB, bBlockedA bool, err error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM relationships WHERE type = 'blocked' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))`, int64(a), int64(b), int64(b), int64(a))
	if err != nil {
		return false, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var u int64
		if err := rows.Scan(&u); err != nil {
			return false, false, err
		}
		if ids.ID(u) == a {
			aBlockedB = true
		} else {
			bBlockedA = true
		}
	}
	return aBlockedB, bBlockedA, rows.Err()
}

// Friends lists uid's friends.
func (s *Store) Friends(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT target_id FROM relationships WHERE user_id = ? AND type = 'friend'`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var u int64
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, ids.ID(u))
	}
	return out, rows.Err()
}

// MutualFriends lists users who are friends with both a and b.
func (s *Store) MutualFriends(ctx context.Context, a, b ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT r1.target_id FROM relationships r1 JOIN relationships r2 ON r1.target_id = r2.target_id WHERE r1.user_id = ? AND r2.user_id = ? AND r1.type = 'friend' AND r2.type = 'friend'`, int64(a), int64(b))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var u int64
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, ids.ID(u))
	}
	return out, rows.Err()
}
