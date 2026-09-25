package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/db"
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
	return s.Tx(ctx, func(tx *db.Tx) error {
		// Postgres runs these side by side; one at a time, so two cannot both
		// read the same "before" and act on it
		if err := tx.Serialise(ctx, "epoch", int64(e.ConvID)); err != nil {
			return err
		}
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
	err := s.Tx(ctx, func(tx *db.Tx) error {
		for _, g := range grants {
			res, err := tx.ExecContext(ctx, `INSERT INTO key_grants (conv_id, epoch, user_id, wrapped_key, wrapped_by, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`, int64(g.ConvID), g.Epoch, int64(g.UserID), g.WrappedKey, int64(g.WrappedBy), now)
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
	if err == nil {
		return false
	}
	msg := err.Error()
	// SQLite says so in words; Postgres uses SQLSTATE 23503.
	return strings.Contains(msg, "FOREIGN KEY constraint failed") || strings.Contains(msg, "SQLSTATE 23503")
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
	return Lacking(entitled, holders), nil
}

// Lacking is the entitled users who are not among the holders.
func Lacking(entitled, holders []ids.ID) []ids.ID {
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
	return out
}

// Entitled lists the users who should hold a conversation's keys: DM and
// group participants, a server's members, or a server channel's viewers.
func (s *Store) Entitled(ctx context.Context, conv ids.ID) ([]ids.ID, error) {
	var typ string
	var serverID sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT type, server_id FROM channels WHERE id = ?`, int64(conv)).Scan(&typ, &serverID)
	if errors.Is(err, sql.ErrNoRows) {
		// a server's own conversation belongs to its members
		if members, err := s.serverMemberIDs(ctx, conv); err == nil {
			return members, nil
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
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
//
// Every client asks on connect and after every keys_needed, and an account
// can hold hundreds of conversations' keys, so the conversations, their
// participants and the holders of their latest keys are each read in one
// query for all of them rather than two or three queries apiece.
func (s *Store) Needs(ctx context.Context, uid ids.ID) ([]KeyNeed, error) {
	held, err := s.heldLatest(ctx, uid)
	if err != nil {
		return nil, err
	}
	convs := make([]ids.ID, len(held))
	for i, e := range held {
		convs[i] = e.ConvID
	}
	kinds, err := s.convKinds(ctx, convs)
	if err != nil {
		return nil, err
	}
	var talks []ids.ID
	for _, c := range convs {
		if k, ok := kinds[c]; ok && IsDMLike(k.typ) {
			talks = append(talks, c)
		}
	}
	participants, err := s.participantsOf(ctx, talks)
	if err != nil {
		return nil, err
	}
	holders, err := s.latestHolders(ctx, convs)
	if err != nil {
		return nil, err
	}
	out := []KeyNeed{}
	for _, e := range held {
		var entitled []ids.ID
		k, isChannel := kinds[e.ConvID]
		switch {
		case isChannel && IsDMLike(k.typ):
			entitled = participants[e.ConvID]
		case isChannel && !k.server.IsZero():
			entitled, err = s.channelViewers(ctx, k.server, e.ConvID)
		default:
			// a server's own conversation, or one the hook knows about
			entitled, err = s.Entitled(ctx, e.ConvID)
		}
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
		lacking := Lacking(entitled, holders[e.ConvID])
		if len(lacking) > 0 || e.rotate {
			out = append(out, KeyNeed{ConvID: e.ConvID, Epoch: e.Epoch, UserIDs: lacking, Rotate: e.rotate})
		}
	}
	return out, nil
}

// convKind is what a conversation id names when it is a channel.
type convKind struct {
	typ    string
	server ids.ID
}

// chunked runs fn over list in pieces small enough for one IN (…).
func chunked(list []ids.ID, fn func(part []ids.ID) error) error {
	for start := 0; start < len(list); start += 500 {
		if err := fn(list[start:min(start+500, len(list))]); err != nil {
			return err
		}
	}
	return nil
}

// convKinds looks up the channels among convs; a conversation that is not a
// channel (a server's own) is simply absent.
func (s *Store) convKinds(ctx context.Context, convs []ids.ID) (map[ids.ID]convKind, error) {
	out := map[ids.ID]convKind{}
	err := chunked(convs, func(part []ids.ID) error {
		rows, err := s.db.R.QueryContext(ctx, `SELECT id, type, server_id FROM channels WHERE id IN (`+placeholders(len(part))+`)`, idArgs(part)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id ids.ID
			var k convKind
			var server sql.NullInt64
			if err := rows.Scan(&id, &k.typ, &server); err != nil {
				return err
			}
			if server.Valid {
				k.server = ids.ID(server.Int64)
			}
			out[id] = k
		}
		return rows.Err()
	})
	return out, err
}

// participantsOf lists the participants of each conversation, in join order.
func (s *Store) participantsOf(ctx context.Context, convs []ids.ID) (map[ids.ID][]ids.ID, error) {
	out := map[ids.ID][]ids.ID{}
	err := chunked(convs, func(part []ids.ID) error {
		rows, err := s.db.R.QueryContext(ctx, `SELECT channel_id, user_id FROM dm_participants WHERE channel_id IN (`+placeholders(len(part))+`) ORDER BY added_at, user_id`, idArgs(part)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ch, u ids.ID
			if err := rows.Scan(&ch, &u); err != nil {
				return err
			}
			out[ch] = append(out[ch], u)
		}
		return rows.Err()
	})
	return out, err
}

// latestHolders lists, for each conversation, who holds a grant for its
// latest epoch.
func (s *Store) latestHolders(ctx context.Context, convs []ids.ID) (map[ids.ID][]ids.ID, error) {
	out := map[ids.ID][]ids.ID{}
	err := chunked(convs, func(part []ids.ID) error {
		rows, err := s.db.R.QueryContext(ctx, `SELECT g.conv_id, g.user_id FROM key_grants g
			WHERE g.conv_id IN (`+placeholders(len(part))+`) AND g.epoch = (SELECT max(e.epoch) FROM key_epochs e WHERE e.conv_id = g.conv_id)`, idArgs(part)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var conv, u ids.ID
			if err := rows.Scan(&conv, &u); err != nil {
				return err
			}
			out[conv] = append(out[conv], u)
		}
		return rows.Err()
	})
	return out, err
}

// SetKeyFlags updates the per-conversation flags (nil leaves a flag alone).
//
// Each flag is written on its own, touching only its column. Read and written
// back together, two changes at once lost one another: a rotation asked for
// because someone lost access could vanish under an unrelated change to the
// other flag, leaving the removed member's key working for new messages.
func (s *Store) SetKeyFlags(ctx context.Context, conv ids.ID, needsRotation, needsOwnKey *bool) error {
	now := nowMs()
	return s.Tx(ctx, func(tx *db.Tx) error {
		if needsRotation != nil {
			v := boolInt(*needsRotation)
			if _, err := tx.ExecContext(ctx, `INSERT INTO key_flags (conv_id, needs_rotation, needs_own_key, updated_at) VALUES (?,?,0,?) ON CONFLICT(conv_id) DO UPDATE SET needs_rotation = excluded.needs_rotation, updated_at = excluded.updated_at`,
				int64(conv), v, now); err != nil {
				return err
			}
		}
		if needsOwnKey != nil {
			v := boolInt(*needsOwnKey)
			if _, err := tx.ExecContext(ctx, `INSERT INTO key_flags (conv_id, needs_rotation, needs_own_key, updated_at) VALUES (?,0,?,?) ON CONFLICT(conv_id) DO UPDATE SET needs_own_key = excluded.needs_own_key, updated_at = excluded.updated_at`,
				int64(conv), v, now); err != nil {
				return err
			}
		}
		return nil
	})
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
