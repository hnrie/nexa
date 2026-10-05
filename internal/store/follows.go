package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// A follow brings what an announcement channel publishes into a channel of
// another server (models in migration 0032). Publishing seals each post to the
// follow's public key; the private key travels sealed with the target
// channel's own key, so only the people in that channel can open the posts.

// MaxFollowsPerChannel bounds how many channels one channel posts into or
// takes posts from.
const MaxFollowsPerChannel = 50

// Follow is one announcement channel followed into one channel.
type Follow struct {
	ID        ids.ID  `json:"id"`
	SourceID  ids.ID  `json:"source_id"`
	TargetID  ids.ID  `json:"target_id"`
	ServerID  ids.ID  `json:"server_id"`
	CreatorID *ids.ID `json:"creator_id"`
	PublicKey []byte  `json:"public_key"`
	// Secret is the private key, sealed with the target channel's key: an
	// envelope only the target channel's people can open.
	Secret    string `json:"secret"`
	CreatedAt int64  `json:"created_at"`
}

const followCols = `id, source_id, target_id, server_id, creator_id, public_key, secret, created_at`

func scanFollow(r rowScanner) (*Follow, error) {
	var f Follow
	var creator sql.NullInt64
	if err := r.Scan(&f.ID, &f.SourceID, &f.TargetID, &f.ServerID, &creator, &f.PublicKey, &f.Secret, &f.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	f.CreatorID = idPtr(creator)
	return &f, nil
}

func (s *Store) queryFollows(ctx context.Context, q string, args ...any) ([]*Follow, error) {
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Follow{}
	for rows.Next() {
		f, err := scanFollow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFollow records a follow. ErrAlreadyExists when the channel already
// follows that one; ErrLimit when either side has as many as it may.
func (s *Store) CreateFollow(ctx context.Context, f *Follow) error {
	if f.ID.IsZero() {
		f.ID = ids.New()
	}
	if f.CreatedAt == 0 {
		f.CreatedAt = nowMs()
	}
	var n int
	if err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM channel_follows WHERE source_id = ? AND target_id = ?`, int64(f.SourceID), int64(f.TargetID)).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrAlreadyExists
	}
	var out, in int
	if err := s.db.R.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM channel_follows WHERE source_id = ?), (SELECT count(*) FROM channel_follows WHERE target_id = ?)`, int64(f.SourceID), int64(f.TargetID)).Scan(&out, &in); err != nil {
		return err
	}
	if in >= MaxFollowsPerChannel {
		return ErrLimit
	}
	res, err := s.db.W.ExecContext(ctx, `INSERT INTO channel_follows (`+followCols+`) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
		int64(f.ID), int64(f.SourceID), int64(f.TargetID), int64(f.ServerID), nullID(f.CreatorID), f.PublicKey, f.Secret, f.CreatedAt)
	if err != nil {
		return err
	}
	// two follows of the same pair racing: the second finds the first
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrAlreadyExists
	}
	return nil
}

// FollowByID loads a follow.
func (s *Store) FollowByID(ctx context.Context, id ids.ID) (*Follow, error) {
	return scanFollow(s.db.R.QueryRowContext(ctx, `SELECT `+followCols+` FROM channel_follows WHERE id = ?`, int64(id)))
}

// FollowersOf lists the follows of an announcement channel.
func (s *Store) FollowersOf(ctx context.Context, sourceID ids.ID) ([]*Follow, error) {
	return s.queryFollows(ctx, `SELECT `+followCols+` FROM channel_follows WHERE source_id = ? ORDER BY id`, int64(sourceID))
}

// FollowsInto lists what a channel follows.
func (s *Store) FollowsInto(ctx context.Context, targetID ids.ID) ([]*Follow, error) {
	return s.queryFollows(ctx, `SELECT `+followCols+` FROM channel_follows WHERE target_id = ? ORDER BY id`, int64(targetID))
}

// FollowsForServer lists every follow posting into a server's channels.
func (s *Store) FollowsForServer(ctx context.Context, serverID ids.ID) ([]*Follow, error) {
	return s.queryFollows(ctx, `SELECT `+followCols+` FROM channel_follows WHERE server_id = ? ORDER BY id`, int64(serverID))
}

// FollowerCount counts how many channels follow an announcement channel.
func (s *Store) FollowerCount(ctx context.Context, sourceID ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM channel_follows WHERE source_id = ?`, int64(sourceID)).Scan(&n)
	return n, err
}

// SetFollowSecret replaces a follow's sealed private key: sealed again under
// the target channel's newest key, so people who came after a key change can
// open it too.
func (s *Store) SetFollowSecret(ctx context.Context, id ids.ID, secret string) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE channel_follows SET secret = ? WHERE id = ?`, secret, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteFollow removes a follow.
func (s *Store) DeleteFollow(ctx context.Context, id ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM channel_follows WHERE id = ?`, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Crosspost is one published copy: the message it is, and where it is.
type Crosspost struct {
	MessageID ids.ID
	ChannelID ids.ID
	FollowID  *ids.ID
}

// InsertCrosspost writes a published copy: the message in the following
// channel, and which post it is a copy of.
func (s *Store) InsertCrosspost(ctx context.Context, m *Message, source, follow ids.ID) error {
	if err := s.InsertMessage(ctx, m); err != nil {
		return err
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO crossposts (message_id, source_id, follow_id) VALUES (?,?,?) ON CONFLICT DO NOTHING`, int64(m.ID), int64(source), int64(follow))
	return err
}

// Crossposts finds the copies of a published post.
func (s *Store) Crossposts(ctx context.Context, sourceMessage ids.ID) ([]Crosspost, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT x.message_id, m.channel_id, x.follow_id FROM crossposts x JOIN messages m ON m.id = x.message_id WHERE x.source_id = ?`, int64(sourceMessage))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Crosspost{}
	for rows.Next() {
		var c Crosspost
		var follow sql.NullInt64
		if err := rows.Scan(&c.MessageID, &c.ChannelID, &follow); err != nil {
			return nil, err
		}
		c.FollowID = idPtr(follow)
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetCrosspost replaces a published copy's sealed text and what it says
// about where it came from (an edit published again, or the original deleted).
func (s *Store) SetCrosspost(ctx context.Context, id ids.ID, ciphertext *string, plain string, editedAt *int64) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE messages SET ciphertext = ?, plain = ?, edited_at = ? WHERE id = ? AND type = 'crosspost'`, nullString(ciphertext), plain, nullInt64(editedAt), int64(id))
	return err
}

// ClearCrosspost empties a copy whose original was deleted: its sealed text
// goes, and so do the files it held, and it says where it came from (plain).
func (s *Store) ClearCrosspost(ctx context.Context, id ids.ID, plain string) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - (SELECT count(*) FROM attachments a WHERE a.message_id = ? AND a.blob_id = blobs.id)")+` WHERE id IN (SELECT blob_id FROM attachments WHERE message_id = ?)`, int64(id), int64(id)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM attachments WHERE message_id = ?`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE messages SET ciphertext = NULL, plain = ? WHERE id = ? AND type = 'crosspost'`, plain, int64(id))
		return err
	})
}

func nullString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}
