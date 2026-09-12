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
	if e.CreatedAt == 0 {
		e.CreatedAt = nowMs()
	}
	return s.Tx(ctx, func(tx *sql.Tx) error {
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
	if typ == "dm" || typ == "group_dm" {
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
}

// HeldLatest lists the conversations (and their latest epoch) that uid holds
// a grant for at that latest epoch.
func (s *Store) HeldLatest(ctx context.Context, uid ids.ID) ([]KeyEpoch, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT g.conv_id, g.epoch FROM key_grants g WHERE g.user_id = ? AND g.epoch = (SELECT max(e.epoch) FROM key_epochs e WHERE e.conv_id = g.conv_id)`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []KeyEpoch{}
	for rows.Next() {
		var e KeyEpoch
		if err := rows.Scan(&e.ConvID, &e.Epoch); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Needs computes, for every conversation uid holds the latest key of, which
// entitled users still lack a grant.
func (s *Store) Needs(ctx context.Context, uid ids.ID) ([]KeyNeed, error) {
	held, err := s.HeldLatest(ctx, uid)
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
		lacking, err := s.UsersLackingGrant(ctx, e.ConvID, e.Epoch, entitled)
		if err != nil {
			return nil, err
		}
		if len(lacking) > 0 {
			out = append(out, KeyNeed{ConvID: e.ConvID, Epoch: e.Epoch, UserIDs: lacking})
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
