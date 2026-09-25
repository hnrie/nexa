package store

import (
	"context"

	"evilion.xyz/chat/internal/ids"
)

// Ack records that uid has read up to msgID in chID. Without force the marker
// never moves backwards; force is used by "mark as unread".
func (s *Store) Ack(ctx context.Context, uid, chID, msgID ids.ID, force bool) error {
	d := s.db.Dialect
	q := `INSERT INTO read_states (user_id, channel_id, last_read_message_id, last_ack_at) VALUES (?,?,?,?)
		ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = ` + d.Greatest("coalesce(read_states.last_read_message_id, 0)", "excluded.last_read_message_id") + `, last_ack_at = excluded.last_ack_at`
	if force {
		q = `INSERT INTO read_states (user_id, channel_id, last_read_message_id, last_ack_at) VALUES (?,?,?,?)
		ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id, last_ack_at = excluded.last_ack_at`
	}
	_, err := s.db.W.ExecContext(ctx, q, int64(uid), int64(chID), int64(msgID), nowMs())
	return err
}

// ReadStatesFor returns the user's read position, unread mention count and,
// for conversations, unread message count in each of the given channels
// (channels without a row get a zero state).
func (s *Store) ReadStatesFor(ctx context.Context, uid ids.ID, channels []ids.ID) ([]*ReadState, error) {
	out := make([]*ReadState, 0, len(channels))
	if len(channels) == 0 {
		return out, nil
	}
	byCh := map[ids.ID]*ReadState{}
	for _, ch := range channels {
		rs := &ReadState{ChannelID: ch}
		byCh[ch] = rs
		out = append(out, rs)
	}
	ph := placeholders(len(channels))
	rows, err := s.db.R.QueryContext(ctx, `SELECT channel_id, last_read_message_id, last_ack_at FROM read_states WHERE user_id = ? AND channel_id IN (`+ph+`)`, append([]any{int64(uid)}, idArgs(channels)...)...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var ch int64
		var last, at sqlNullInt
		if err := rows.Scan(&ch, &last, &at); err != nil {
			rows.Close()
			return nil, err
		}
		if rs := byCh[ids.ID(ch)]; rs != nil {
			if last.Valid {
				v := ids.ID(last.Int64)
				rs.LastReadMessageID = &v
			}
			rs.LastAckAt = at.Int64
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Mentions sent before the user joined the server or was added to the
	// conversation never count, so a newcomer is not greeted with every old
	// @everyone. The join time becomes the lowest snowflake of that millisecond
	// (ids keep the millisecond above 22 bits). Counting per channel lets each
	// count walk the messages_channel index from the floor instead of scanning
	// the whole channel. Conversations also count their unread messages. Both
	// counts stop at MaxUnreadCount — past it a badge says 99+ either way — so
	// a long-ignored channel costs no more than a short one: this runs inside
	// ready, on every connect, for every channel, and uncapped the mention count
	// parsed the mentions of every message since the person joined.
	// A mention of a role counts for whoever holds the role now.
	mentioned := s.db.Dialect.JSONArrayHas("m.mentions")
	roleMentioned := `m.mention_roles <> '[]' AND EXISTS (SELECT 1 FROM member_roles mr WHERE mr.server_id = f.server_id AND mr.user_id = ? AND ` + s.db.Dialect.JSONArrayHasExpr("m.mention_roles", "mr.role_id") + `)`
	floor := s.db.Dialect.Greatest(
		"coalesce(r.last_read_message_id, 0)",
		"coalesce(((coalesce(sm.joined_at, p.added_at) - ?) << 22) - 1, 0)",
	)
	args := []any{int64(uid), uid.String(), int64(uid), MaxUnreadCount, int64(uid), MaxUnreadCount, ids.Epoch, int64(uid), int64(uid), int64(uid)}
	args = append(args, idArgs(channels)...)
	mrows, err := s.db.R.QueryContext(ctx, `SELECT f.id,
			(SELECT count(*) FROM (SELECT 1 FROM messages m
				WHERE m.channel_id = f.id AND m.author_id != ? AND m.id > f.floor
				AND (m.mention_everyone = 1 OR `+mentioned+` OR (`+roleMentioned+`)) LIMIT ?) AS mentions_capped),
			CASE WHEN f.type IN ('dm', 'group_dm', 'subchat') THEN (SELECT count(*) FROM (SELECT 1 FROM messages m
				WHERE m.channel_id = f.id AND m.author_id != ? AND m.id > f.floor LIMIT ?) AS capped) ELSE 0 END
		FROM (SELECT c.id, c.type, c.server_id, `+floor+` AS floor
			FROM channels c
			LEFT JOIN read_states r ON r.channel_id = c.id AND r.user_id = ?
			LEFT JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
			LEFT JOIN dm_participants p ON p.channel_id = c.id AND p.user_id = ?
			WHERE c.id IN (`+ph+`)) f`, args...)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var ch int64
		var mentions, unread int
		if err := mrows.Scan(&ch, &mentions, &unread); err != nil {
			return nil, err
		}
		if rs := byCh[ids.ID(ch)]; rs != nil {
			rs.MentionCount = mentions
			rs.UnreadCount = unread
		}
	}
	return out, mrows.Err()
}

// CountMentionsAfter counts unread mentions of uid in a channel after afterID,
// its roles' included.
func (s *Store) CountMentionsAfter(ctx context.Context, chID, uid, afterID ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM messages m JOIN channels c ON c.id = m.channel_id
		WHERE m.channel_id = ? AND m.author_id != ? AND m.id > ? AND (m.mention_everyone = 1 OR `+s.db.Dialect.JSONArrayHas("m.mentions")+`
			OR (m.mention_roles <> '[]' AND EXISTS (SELECT 1 FROM member_roles mr WHERE mr.server_id = c.server_id AND mr.user_id = ? AND `+s.db.Dialect.JSONArrayHasExpr("m.mention_roles", "mr.role_id")+`)))`,
		int64(chID), int64(uid), int64(afterID), uid.String(), int64(uid)).Scan(&n)
	return n, err
}
