package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// ChannelLock is the password on a subchat, as the client needs it to derive
// the same key again. Hash never leaves the server.
type ChannelLock struct {
	Salt   []byte
	Params string
	Hash   string
}

// Locked reports whether a lock is actually set.
func (l ChannelLock) Locked() bool { return l.Hash != "" }

// LockOf reads a channel's password material.
func (s *Store) LockOf(ctx context.Context, channelID ids.ID) (ChannelLock, error) {
	var l ChannelLock
	var salt []byte
	err := s.db.R.QueryRowContext(ctx, `SELECT lock_salt, lock_params, lock_hash FROM channels WHERE id = ?`, int64(channelID)).Scan(&salt, &l.Params, &l.Hash)
	if errors.Is(err, sql.ErrNoRows) {
		return l, ErrNotFound
	}
	if err != nil {
		return l, err
	}
	l.Salt = salt
	return l, nil
}

// SetLock puts a password on a channel, or takes it off with an empty hash.
// Every session that had typed the old one has to type the new one.
func (s *Store) SetLock(ctx context.Context, channelID ids.ID, l ChannelLock) error {
	return s.db.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE channels SET lock_salt = ?, lock_params = ?, lock_hash = ?, updated_at = ? WHERE id = ?`,
			nullBytes(l.Salt), l.Params, l.Hash, nowMs(), int64(channelID)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM channel_unlocks WHERE channel_id = ?`, int64(channelID))
		return err
	})
}

// MarkUnlocked records that this session has typed the password.
func (s *Store) MarkUnlocked(ctx context.Context, channelID, sessionID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO channel_unlocks (channel_id, session_id, created_at) VALUES (?,?,?)
		ON CONFLICT(channel_id, session_id) DO UPDATE SET created_at = excluded.created_at`,
		int64(channelID), int64(sessionID), nowMs())
	return err
}

// IsUnlocked reports whether this session has typed the channel's password.
func (s *Store) IsUnlocked(ctx context.Context, channelID, sessionID ids.ID) (bool, error) {
	var one int
	err := s.db.R.QueryRowContext(ctx, `SELECT 1 FROM channel_unlocks WHERE channel_id = ? AND session_id = ?`, int64(channelID), int64(sessionID)).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// LockedChannelsFor lists which of the given channels carry a password, so a
// client can mark them without asking one by one.
func (s *Store) LockedChannelsFor(ctx context.Context, parentID ids.ID) (map[ids.ID]bool, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id FROM channels WHERE parent_id = ? AND lock_hash <> ''`, int64(parentID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ids.ID]bool{}
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
