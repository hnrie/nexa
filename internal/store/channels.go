package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/ids"
)

const channelCols = `id, server_id, type, name, topic, position, parent_id, nsfw, slowmode_seconds, user_limit, owner_id, icon_id, last_message_id, created_at, updated_at`

// MaxSubchats caps how many side conversations one DM can carry.
const MaxSubchats = 50

// IsDMLike reports whether a channel type is a conversation between people
// rather than part of a server: a DM, a group, or a subchat inside one.
func IsDMLike(t string) bool { return t == "dm" || t == "group_dm" || t == "subchat" }

func scanChannel(r rowScanner) (*Channel, error) {
	var c Channel
	var server, parent, owner, icon, last sql.NullInt64
	var nsfw int64
	var updated int64
	if err := r.Scan(&c.ID, &server, &c.Type, &c.Name, &c.Topic, &c.Position, &parent, &nsfw, &c.SlowmodeSeconds, &c.UserLimit, &owner, &icon, &last, &c.CreatedAt, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.ServerID, c.ParentID, c.OwnerID, c.IconID, c.LastMessageID = idPtr(server), idPtr(parent), idPtr(owner), idPtr(icon), idPtr(last)
	c.NSFW = nsfw == 1
	// the default key conversation; callers that know about private-channel epochs refine it
	if c.ServerID != nil {
		c.KeyConvID = *c.ServerID
	} else {
		c.KeyConvID = c.ID
	}
	return &c, nil
}

func (s *Store) insertChannel(ctx context.Context, q querier, c *Channel) error {
	if c.ID.IsZero() {
		c.ID = ids.New()
	}
	if c.CreatedAt == 0 {
		c.CreatedAt = nowMs()
	}
	_, err := q.ExecContext(ctx, `INSERT INTO channels (`+channelCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		int64(c.ID), nullID(c.ServerID), c.Type, c.Name, c.Topic, c.Position, nullID(c.ParentID), boolInt(c.NSFW), c.SlowmodeSeconds, c.UserLimit, nullID(c.OwnerID), nullID(c.IconID), nullID(c.LastMessageID), c.CreatedAt, c.CreatedAt)
	return err
}

// CreateDM returns the DM between a and b, creating it when missing.
func (s *Store) CreateDM(ctx context.Context, a, b ids.ID) (*Channel, bool, error) {
	c := &Channel{Type: "dm"}
	var existing int64
	now := nowMs()
	// The lookup runs inside the write transaction: writes go through one
	// connection, so two people tapping Message at once cannot both miss the
	// pair and open two conversations.
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT c.id FROM channels c
			JOIN dm_participants p1 ON p1.channel_id = c.id AND p1.user_id = ?
			JOIN dm_participants p2 ON p2.channel_id = c.id AND p2.user_id = ?
			WHERE c.type = 'dm' ORDER BY c.id LIMIT 1`, int64(a), int64(b)).Scan(&existing)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err := s.insertChannel(ctx, tx, c); err != nil {
			return err
		}
		for _, uid := range []ids.ID{a, b} {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO dm_participants (channel_id, user_id, added_by, added_at) VALUES (?,?,?,?)`, int64(c.ID), int64(uid), int64(a), now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if existing != 0 {
		c, err := s.ChannelByID(ctx, ids.ID(existing))
		return c, false, err
	}
	c.Recipients = []ids.ID{a, b}
	return c, true, nil
}

// CreateGroupDM creates a group with owner and recipients.
func (s *Store) CreateGroupDM(ctx context.Context, owner ids.ID, recipients []ids.ID, name string) (*Channel, error) {
	c := &Channel{Type: "group_dm", Name: name}
	o := owner
	c.OwnerID = &o
	members := append([]ids.ID{owner}, recipients...)
	now := nowMs()
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		if err := s.insertChannel(ctx, tx, c); err != nil {
			return err
		}
		for _, uid := range members {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO dm_participants (channel_id, user_id, added_by, added_at) VALUES (?,?,?,?)`, int64(c.ID), int64(uid), int64(owner), now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.ChannelByID(ctx, c.ID)
}

// ChannelByID loads a channel (with recipients for DMs).
func (s *Store) ChannelByID(ctx context.Context, id ids.ID) (*Channel, error) {
	c, err := scanChannel(s.db.R.QueryRowContext(ctx, `SELECT `+channelCols+` FROM channels WHERE id = ?`, int64(id)))
	if err != nil {
		return nil, err
	}
	if IsDMLike(c.Type) {
		if c.Recipients, err = s.Participants(ctx, c.ID); err != nil {
			return nil, err
		}
		c.KeyConvID = c.ID
		return c, nil
	}
	c.Recipients = []ids.ID{}
	if c.ServerID != nil {
		c.KeyConvID = *c.ServerID
		if _, own, err := s.LatestEpoch(ctx, c.ID); err != nil {
			return nil, err
		} else if own {
			c.KeyConvID = c.ID
		}
		if c.Overwrites, err = s.Overwrites(ctx, c.ID); err != nil {
			return nil, err
		}
	}
	return c, nil
}

// GroupDMsForUser lists every group DM the user is in, hidden ones included.
func (s *Store) GroupDMsForUser(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT c.id FROM channels c JOIN dm_participants p ON p.channel_id = c.id WHERE c.type = 'group_dm' AND p.user_id = ?`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DMChannelsForUser lists the DMs and group DMs the user is in.
func (s *Store) DMChannelsForUser(ctx context.Context, uid ids.ID) ([]*Channel, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+channelCols+` FROM channels c WHERE c.type IN ('dm','group_dm','subchat') AND EXISTS (SELECT 1 FROM dm_participants p WHERE p.channel_id = c.id AND p.user_id = ? AND p.hidden = 0) ORDER BY coalesce(c.last_message_id, c.id) DESC`, int64(uid))
	if err != nil {
		return nil, err
	}
	var out []*Channel
	byID := map[ids.ID]*Channel{}
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		c.Recipients = []ids.ID{}
		out = append(out, c)
		byID[c.ID] = c
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return []*Channel{}, nil
	}
	list := make([]ids.ID, 0, len(out))
	for _, c := range out {
		list = append(list, c.ID)
	}
	prow, err := s.db.R.QueryContext(ctx, `SELECT channel_id, user_id FROM dm_participants WHERE channel_id IN (`+placeholders(len(list))+`) ORDER BY added_at, user_id`, idArgs(list)...)
	if err != nil {
		return nil, err
	}
	defer prow.Close()
	for prow.Next() {
		var ch, u int64
		if err := prow.Scan(&ch, &u); err != nil {
			return nil, err
		}
		if c := byID[ids.ID(ch)]; c != nil {
			c.Recipients = append(c.Recipients, ids.ID(u))
		}
	}
	return out, prow.Err()
}

// CreateSubchat opens a side conversation inside a DM or group, with the same
// people in it. It gets its own key conversation, so its messages are sealed
// separately from the parent's.
func (s *Store) CreateSubchat(ctx context.Context, parent *Channel, owner ids.ID, name string) (*Channel, error) {
	ch := &Channel{Type: "subchat", Name: name, ParentID: &parent.ID, OwnerID: &owner}
	var members []ids.ID
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM channels WHERE parent_id = ? AND type = 'subchat'`, int64(parent.ID)).Scan(&n); err != nil {
			return err
		}
		if n >= MaxSubchats {
			return ErrTooMany
		}
		// the members are read inside the transaction, so someone who left the
		// conversation a moment ago is not copied in from a stale list
		var err error
		if members, err = idsTx(ctx, tx, `SELECT user_id FROM dm_participants WHERE channel_id = ? ORDER BY added_at, user_id`, int64(parent.ID)); err != nil {
			return err
		}
		if len(members) == 0 {
			return ErrNotFound
		}
		if err := s.insertChannel(ctx, tx, ch); err != nil {
			return err
		}
		now := nowMs()
		for _, uid := range members {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO dm_participants (channel_id, user_id, added_by, added_at, hidden) VALUES (?,?,?,?,0)`,
				int64(ch.ID), int64(uid), int64(owner), now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	ch.Recipients = members
	ch.KeyConvID = ch.ID
	return ch, nil
}

// SubchatsFor lists the side conversations of one DM, newest activity first.
func (s *Store) SubchatsFor(ctx context.Context, parentID ids.ID) ([]*Channel, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+channelCols+` FROM channels WHERE parent_id = ? AND type = 'subchat' ORDER BY coalesce(last_message_id, id) DESC`, int64(parentID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Channel{}
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		c.KeyConvID = c.ID
		if c.Recipients, err = s.Participants(ctx, c.ID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// IsParticipant reports whether uid is in the DM channel.
func (s *Store) IsParticipant(ctx context.Context, chID, uid ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM dm_participants WHERE channel_id = ? AND user_id = ?`, int64(chID), int64(uid)).Scan(&n)
	return n > 0, err
}

// Participants lists the members of a DM channel in join order.
func (s *Store) Participants(ctx context.Context, chID ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM dm_participants WHERE channel_id = ? ORDER BY added_at, user_id`, int64(chID))
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

// AddParticipant adds uid to a group DM and to every subchat inside it, since
// a subchat holds the same people as its group. It returns the subchats uid
// joined, or ErrAlreadyExists when uid is already in the group.
func (s *Store) AddParticipant(ctx context.Context, chID, uid, addedBy ids.ID) ([]ids.ID, error) {
	var subs []ids.ID
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		now := nowMs()
		res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO dm_participants (channel_id, user_id, added_by, added_at) VALUES (?,?,?,?)`, int64(chID), int64(uid), int64(addedBy), now)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrAlreadyExists
		}
		if subs, err = idsTx(ctx, tx, `SELECT c.id FROM channels c WHERE c.parent_id = ? AND c.type = 'subchat'
			AND NOT EXISTS (SELECT 1 FROM dm_participants p WHERE p.channel_id = c.id AND p.user_id = ?)`, int64(chID), int64(uid)); err != nil {
			return err
		}
		for _, id := range subs {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO dm_participants (channel_id, user_id, added_by, added_at, hidden) VALUES (?,?,?,?,0)`, int64(id), int64(uid), int64(addedBy), now); err != nil {
				return err
			}
		}
		return nil
	})
	return subs, err
}

// RemoveParticipant removes uid from a group DM and from every subchat inside
// it, returning the subchats uid was taken out of.
func (s *Store) RemoveParticipant(ctx context.Context, chID, uid ids.ID) ([]ids.ID, error) {
	var subs []ids.ID
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM dm_participants WHERE channel_id = ? AND user_id = ?`, int64(chID), int64(uid))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if subs, err = idsTx(ctx, tx, `SELECT p.channel_id FROM dm_participants p JOIN channels c ON c.id = p.channel_id
			WHERE c.parent_id = ? AND c.type = 'subchat' AND p.user_id = ?`, int64(chID), int64(uid)); err != nil {
			return err
		}
		for _, id := range subs {
			if _, err := tx.ExecContext(ctx, `DELETE FROM dm_participants WHERE channel_id = ? AND user_id = ?`, int64(id), int64(uid)); err != nil {
				return err
			}
		}
		return nil
	})
	return subs, err
}

// idsTx runs a query returning one id column inside a transaction.
func idsTx(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]ids.ID, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, ids.ID(id))
	}
	return out, rows.Err()
}

// RevokeChannelInvites deletes every invite link to a group, so someone who
// was removed cannot walk back in with a code they saw while they were in it.
func (s *Store) RevokeChannelInvites(ctx context.Context, chID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM invites WHERE channel_id = ?`, int64(chID))
	return err
}

// UpdateChannel applies p.
func (s *Store) UpdateChannel(ctx context.Context, id ids.ID, p ChannelPatch) error {
	var sets []string
	var args []any
	set := func(col string, v any) { sets = append(sets, col+" = ?"); args = append(args, v) }
	if p.Name != nil {
		set("name", *p.Name)
	}
	if p.Topic != nil {
		set("topic", *p.Topic)
	}
	if p.IconID != nil {
		set("icon_id", nullID(*p.IconID))
	}
	if p.OwnerID != nil {
		set("owner_id", int64(*p.OwnerID))
	}
	if p.NSFW != nil {
		set("nsfw", boolInt(*p.NSFW))
	}
	if p.SlowmodeSeconds != nil {
		set("slowmode_seconds", *p.SlowmodeSeconds)
	}
	if p.UserLimit != nil {
		set("user_limit", *p.UserLimit)
	}
	if p.ParentID != nil {
		set("parent_id", nullID(*p.ParentID))
	}
	if p.Position != nil {
		set("position", *p.Position)
	}
	if len(sets) == 0 {
		return nil
	}
	set("updated_at", nowMs())
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE channels SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteChannel removes a channel and everything in it. Deleting a category
// leaves its children in place without a parent; deleting a conversation
// deletes its subchats with it, since nothing could reach them afterwards.
func (s *Store) DeleteChannel(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		subs, err := idsTx(ctx, tx, `SELECT id FROM channels WHERE parent_id = ? AND type = 'subchat'`, int64(id))
		if err != nil {
			return err
		}
		for _, sub := range subs {
			if err := deleteChannelTx(ctx, tx, sub); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE channels SET parent_id = NULL WHERE parent_id = ?`, int64(id)); err != nil {
			return err
		}
		return deleteChannelTx(ctx, tx, id)
	})
}

func deleteChannelTx(ctx context.Context, tx *sql.Tx, id ids.ID) error {
	// release attachment blobs, and a group's icon
	if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = max(0, ref_count - 1) WHERE id IN (SELECT blob_id FROM attachments WHERE channel_id = ?)`, int64(id)); err != nil {
		return err
	}
	if err := releaseBlobRefs(ctx, tx, `SELECT icon_id FROM channels WHERE id = ?`, int64(id)); err != nil {
		return err
	}
	for _, q := range []string{`DELETE FROM key_grants WHERE conv_id = ?`, `DELETE FROM key_epochs WHERE conv_id = ?`, `DELETE FROM key_flags WHERE conv_id = ?`} {
		if _, err := tx.ExecContext(ctx, q, int64(id)); err != nil {
			return err
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM channels WHERE id = ?`, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// HideDM closes (or reopens) a DM for one participant. A hidden DM stays out
// of their sidebar until it has something new in it.
func (s *Store) HideDM(ctx context.Context, chID, uid ids.ID, hidden bool) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE dm_participants SET hidden = ? WHERE channel_id = ? AND user_id = ?`, boolInt(hidden), int64(chID), int64(uid))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReopenDM puts a closed DM back in one participant's sidebar, reporting
// whether it had been closed.
func (s *Store) ReopenDM(ctx context.Context, chID, uid ids.ID) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE dm_participants SET hidden = 0 WHERE channel_id = ? AND user_id = ? AND hidden = 1`, int64(chID), int64(uid))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// UnhideDM reopens a conversation for everyone who had closed it, returning
// those users so the caller can put it back in their sidebar.
func (s *Store) UnhideDM(ctx context.Context, chID ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM dm_participants WHERE channel_id = ? AND hidden = 1`, int64(chID))
	if err != nil {
		return nil, err
	}
	out := []ids.ID{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, ids.ID(id))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	_, err = s.db.W.ExecContext(ctx, `UPDATE dm_participants SET hidden = 0 WHERE channel_id = ? AND hidden = 1`, int64(chID))
	return out, err
}

// DeleteChannel removes a channel and everything hanging off it.
func (s *Store) DeleteDMChannel(ctx context.Context, chID ids.ID) error {
	return s.DeleteChannel(ctx, chID)
}
