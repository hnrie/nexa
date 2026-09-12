package store

import (
	"context"

	"evilion.xyz/chat/internal/ids"
)

// Ack records that uid has read up to msgID in chID (never moving backwards).
func (s *Store) Ack(ctx context.Context, uid, chID, msgID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO read_states (user_id, channel_id, last_read_message_id, last_ack_at) VALUES (?,?,?,?)
		ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_message_id = max(coalesce(last_read_message_id, 0), excluded.last_read_message_id), last_ack_at = excluded.last_ack_at`,
		int64(uid), int64(chID), int64(msgID), nowMs())
	return err
}

// ReadStatesFor returns the user's read position and unread mention count for
// each of the given channels (channels without a row get a zero state).
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
	args := []any{int64(uid), int64(uid), uid.String()}
	args = append(args, idArgs(channels)...)
	mrows, err := s.db.R.QueryContext(ctx, `SELECT m.channel_id, count(*) FROM messages m
		LEFT JOIN read_states r ON r.channel_id = m.channel_id AND r.user_id = ?
		WHERE m.author_id != ? AND m.id > coalesce(r.last_read_message_id, 0)
		AND (m.mention_everyone = 1 OR EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?))
		AND m.channel_id IN (`+ph+`) GROUP BY m.channel_id`, args...)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var ch int64
		var n int
		if err := mrows.Scan(&ch, &n); err != nil {
			return nil, err
		}
		if rs := byCh[ids.ID(ch)]; rs != nil {
			rs.MentionCount = n
		}
	}
	return out, mrows.Err()
}

// CountMentionsAfter counts unread mentions of uid in a channel after afterID.
func (s *Store) CountMentionsAfter(ctx context.Context, chID, uid, afterID ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM messages m WHERE m.channel_id = ? AND m.author_id != ? AND m.id > ? AND (m.mention_everyone = 1 OR EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?))`, int64(chID), int64(uid), int64(afterID), uid.String()).Scan(&n)
	return n, err
}
