package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// CreateEpoch inserts the next epoch for a conversation. The caller passes the
// epoch it expects to create; anything but latest+1 (or 0 for a new
// conversation) returns ErrConflict.
func (s *Store) CreateEpoch(ctx context.Context, e *KeyEpoch) error {
	return s.createEpoch(ctx, e, false)
}

// CreatePendingEpoch is CreateEpoch for a rotation someone losing access asked
// for: it only succeeds while that rotation is still pending, so when every
// online device answers the same request only the first creates an epoch and
// the rest get ErrConflict.
func (s *Store) CreatePendingEpoch(ctx context.Context, e *KeyEpoch) error {
	return s.createEpoch(ctx, e, true)
}

func (s *Store) createEpoch(ctx context.Context, e *KeyEpoch, pending bool) error {
	if e.CreatedAt == 0 {
		e.CreatedAt = nowMs()
	}
	return s.Tx(ctx, func(tx *sql.Tx) error {
		if pending {
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM key_flags WHERE conv_id = ? AND needs_rotation = 1`, int64(e.ConvID)).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				return ErrConflict
			}
		}
		var max sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT max(epoch) FROM key_epochs WHERE conv_id = ?`, int64(e.ConvID)).Scan(&max); err != nil {
			return err
		}
		want := 0
		if max.Valid {
			want = int(max.Int64) + 1
		}
		if e.Epoch != want {
			return ErrConflict
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO key_epochs (conv_id, epoch, created_by, created_at, reason) VALUES (?,?,?,?,?)`, int64(e.ConvID), e.Epoch, int64(e.CreatedBy), e.CreatedAt, e.Reason)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO key_flags (conv_id, needs_rotation, needs_own_key, updated_at) VALUES (?,0,0,?) ON CONFLICT(conv_id) DO UPDATE SET needs_rotation = 0, needs_own_key = 0, updated_at = excluded.updated_at`, int64(e.ConvID), e.CreatedAt)
		return err
	})
}

// LatestEpoch returns the highest epoch of a conversation, and whether any exists.
func (s *Store) LatestEpoch(ctx context.Context, conv ids.ID) (int, bool, error) {
	var max sql.NullInt64
	if err := s.db.R.QueryRowContext(ctx, `SELECT max(epoch) FROM key_epochs WHERE conv_id = ?`, int64(conv)).Scan(&max); err != nil {
		return 0, false, err
	}
	if !max.Valid {
		return 0, false, nil
	}
	return int(max.Int64), true, nil
}

// Epochs lists a conversation's epochs ascending.
func (s *Store) Epochs(ctx context.Context, conv ids.ID) ([]*KeyEpoch, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT conv_id, epoch, created_by, created_at, reason FROM key_epochs WHERE conv_id = ? ORDER BY epoch`, int64(conv))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*KeyEpoch{}
	for rows.Next() {
		var e KeyEpoch
		if err := rows.Scan(&e.ConvID, &e.Epoch, &e.CreatedBy, &e.CreatedAt, &e.Reason); err != nil {
			return nil, err
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}

// PutGrants stores grants, ignoring ones that already exist. Returns how many
// were inserted; grants for unknown epochs fail with ErrNotFound.
func (s *Store) PutGrants(ctx context.Context, grants []KeyGrant) (int, error) {
	inserted := 0
	now := nowMs()
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		for _, g := range grants {
			res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO key_grants (conv_id, epoch, user_id, wrapped_key, wrapped_by, created_at) VALUES (?,?,?,?,?,?)`, int64(g.ConvID), g.Epoch, int64(g.UserID), g.WrappedKey, int64(g.WrappedBy), now)
			if err != nil {
				if isFKError(err) {
					return ErrNotFound
				}
				return err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				inserted++
			}
		}
		return nil
	})
	return inserted, err
}

func isFKError(err error) bool {
	return err != nil && (contains(err.Error(), "FOREIGN KEY constraint failed"))
}

func contains(s, sub string) bool {
	return len(sub) <= len(s) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func scanGrants(rows *sql.Rows) ([]*KeyGrant, error) {
	defer rows.Close()
	out := []*KeyGrant{}
	for rows.Next() {
		var g KeyGrant
		if err := rows.Scan(&g.ConvID, &g.Epoch, &g.UserID, &g.WrappedKey, &g.WrappedBy, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &g)
	}
	return out, rows.Err()
}

// GrantsForUser returns every grant addressed to uid.
func (s *Store) GrantsForUser(ctx context.Context, uid ids.ID) ([]*KeyGrant, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT conv_id, epoch, user_id, wrapped_key, wrapped_by, created_at FROM key_grants WHERE user_id = ? ORDER BY conv_id, epoch`, int64(uid))
	if err != nil {
		return nil, err
	}
	return scanGrants(rows)
}

// Grant returns one grant, or ErrNotFound.
func (s *Store) Grant(ctx context.Context, conv ids.ID, epoch int, uid ids.ID) (*KeyGrant, error) {
	var g KeyGrant
	err := s.db.R.QueryRowContext(ctx, `SELECT conv_id, epoch, user_id, wrapped_key, wrapped_by, created_at FROM key_grants WHERE conv_id = ? AND epoch = ? AND user_id = ?`, int64(conv), epoch, int64(uid)).Scan(&g.ConvID, &g.Epoch, &g.UserID, &g.WrappedKey, &g.WrappedBy, &g.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// HoldersOf lists users holding a grant for conv/epoch.
func (s *Store) HoldersOf(ctx context.Context, conv ids.ID, epoch int) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM key_grants WHERE conv_id = ? AND epoch = ?`, int64(conv), epoch)
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

// UsersLackingGrant returns the entitled users with no grant for conv/epoch.
func (s *Store) UsersLackingGrant(ctx context.Context, conv ids.ID, epoch int, entitled []ids.ID) ([]ids.ID, error) {
	holders, err := s.HoldersOf(ctx, conv, epoch)
	if err != nil {
		return nil, err
	}
	has := make(map[ids.ID]bool, len(holders))
	for _, h := range holders {
		has[h] = true
	}
	out := []ids.ID{}
	for _, u := range entitled {
		if !has[u] {
			out = append(out, u)
		}
	}
	return out, nil
}

// Entitled lists the users who should hold a conversation's keys: DM and
// group participants, a server's members, or a server channel's viewers.
func (s *Store) Entitled(ctx context.Context, conv ids.ID) ([]ids.ID, error) {
	var typ string
	var serverID sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT type, server_id FROM channels WHERE id = ?`, int64(conv)).Scan(&typ, &serverID)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := s.ServerByID(ctx, conv); err == nil {
			return s.MemberIDs(ctx, conv)
		}
		if s.EntitledHook != nil {
			return s.EntitledHook(ctx, conv)
		}
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if IsDMLike(typ) {
		return s.Participants(ctx, conv)
	}
	if serverID.Valid {
		return s.channelViewers(ctx, ids.ID(serverID.Int64), conv)
	}
	if s.EntitledHook != nil {
		return s.EntitledHook(ctx, conv)
	}
	return nil, ErrNotFound
}

// KeyNeed describes users lacking a grant for a conversation epoch.
type KeyNeed struct {
	ConvID  ids.ID   `json:"conv_id"`
	Epoch   int      `json:"epoch"`
	UserIDs []ids.ID `json:"user_ids"`
	// Rotate asks the holder to replace the key: someone lost access while
	// nobody holding it was online to do so.
	Rotate bool `json:"rotate,omitempty"`
}

// heldKey is a conversation whose latest key a user holds.
type heldKey struct {
	KeyEpoch
	rotate bool
}

// heldLatest lists the conversations (and their latest epoch) that uid holds
// a grant for at that latest epoch, and whether each still needs rotating. A
// grant the user wrapped for themselves only counts on an epoch they created:
// the server cannot tell a key from an invite link from junk, so such a
// holder is not asked to share it.
func (s *Store) heldLatest(ctx context.Context, uid ids.ID) ([]heldKey, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT g.conv_id, g.epoch, coalesce(f.needs_rotation, 0) FROM key_grants g
		JOIN key_epochs e ON e.conv_id = g.conv_id AND e.epoch = g.epoch
		LEFT JOIN key_flags f ON f.conv_id = g.conv_id
		WHERE g.user_id = ? AND g.epoch = (SELECT max(m.epoch) FROM key_epochs m WHERE m.conv_id = g.conv_id)
		AND (g.wrapped_by != g.user_id OR e.created_by = g.user_id)`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []heldKey{}
	for rows.Next() {
		var h heldKey
		var rot int64
		if err := rows.Scan(&h.ConvID, &h.Epoch, &rot); err != nil {
			return nil, err
		}
		h.rotate = rot == 1
		out = append(out, h)
	}
	return out, rows.Err()
}

// Needs computes, for every conversation uid holds the latest key of and is
// still part of, which entitled users lack a grant and whether the key is
// waiting to be rotated.
func (s *Store) Needs(ctx context.Context, uid ids.ID) ([]KeyNeed, error) {
	held, err := s.heldLatest(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := []KeyNeed{}
	for _, e := range held {
		entitled, err := s.Entitled(ctx, e.ConvID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		member := false
		for _, id := range entitled {
			if id == uid {
				member = true
				break
			}
		}
		if !member {
			// a key kept from a conversation the user has left is not theirs to share
			continue
		}
		lacking, err := s.UsersLackingGrant(ctx, e.ConvID, e.Epoch, entitled)
		if err != nil {
			return nil, err
		}
		if len(lacking) > 0 || e.rotate {
			out = append(out, KeyNeed{ConvID: e.ConvID, Epoch: e.Epoch, UserIDs: lacking, Rotate: e.rotate})
		}
	}
	return out, nil
}

// SetKeyFlags updates the per-conversation flags (nil leaves a flag alone).
func (s *Store) SetKeyFlags(ctx context.Context, conv ids.ID, needsRotation, needsOwnKey *bool) error {
	cur, err := s.KeyFlags(ctx, conv)
	if err != nil {
		return err
	}
	if needsRotation != nil {
		cur.NeedsRotation = *needsRotation
	}
	if needsOwnKey != nil {
		cur.NeedsOwnKey = *needsOwnKey
	}
	_, err = s.db.W.ExecContext(ctx, `INSERT INTO key_flags (conv_id, needs_rotation, needs_own_key, updated_at) VALUES (?,?,?,?) ON CONFLICT(conv_id) DO UPDATE SET needs_rotation = excluded.needs_rotation, needs_own_key = excluded.needs_own_key, updated_at = excluded.updated_at`,
		int64(conv), boolInt(cur.NeedsRotation), boolInt(cur.NeedsOwnKey), nowMs())
	return err
}

// KeyFlags reads the flags (zero values when no row exists).
func (s *Store) KeyFlags(ctx context.Context, conv ids.ID) (*KeyFlags, error) {
	var rot, own int64
	err := s.db.R.QueryRowContext(ctx, `SELECT needs_rotation, needs_own_key FROM key_flags WHERE conv_id = ?`, int64(conv)).Scan(&rot, &own)
	if errors.Is(err, sql.ErrNoRows) {
		return &KeyFlags{ConvID: conv}, nil
	}
	if err != nil {
		return nil, err
	}
	return &KeyFlags{ConvID: conv, NeedsRotation: rot == 1, NeedsOwnKey: own == 1}, nil
}

// Epoch loads one epoch row.
func (s *Store) Epoch(ctx context.Context, conv ids.ID, epoch int) (*KeyEpoch, error) {
	var e KeyEpoch
	err := s.db.R.QueryRowContext(ctx, `SELECT conv_id, epoch, created_by, created_at, reason FROM key_epochs WHERE conv_id = ? AND epoch = ?`, int64(conv), epoch).Scan(&e.ConvID, &e.Epoch, &e.CreatedBy, &e.CreatedAt, &e.Reason)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}
