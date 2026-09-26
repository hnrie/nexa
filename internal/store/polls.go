package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// Polls ride on webhook messages. What a poll asks and offers is part of the
// message; the polls row holds only what the server enforces: how many
// answers there are, whether more than one may be picked, and when it closes.
// poll_votes.option_index holds an answer's id, from 1.

var (
	// ErrPollClosed is a vote on a poll whose time has run out.
	ErrPollClosed = errors.New("poll closed")
	// ErrBadVote names an answer the poll does not have, or several on a
	// poll that takes one.
	ErrBadVote = errors.New("bad vote")
)

// Poll is a poll's row.
type Poll struct {
	MessageID   ids.ID
	Answers     int
	Multiselect bool
	ExpiresAt   *int64
	EndedAt     *int64
}

// Closed reports whether the poll takes no more votes at now.
func (p *Poll) Closed(now int64) bool {
	return p.EndedAt != nil || (p.ExpiresAt != nil && *p.ExpiresAt <= now)
}

// PollByMessage loads a message's poll.
func (s *Store) PollByMessage(ctx context.Context, msgID ids.ID) (*Poll, error) {
	var p Poll
	var multi int64
	var exp, ended sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT message_id, options_count, multiselect, expires_at, ended_at FROM polls WHERE message_id = ?`, int64(msgID)).
		Scan(&p.MessageID, &p.Answers, &multi, &exp, &ended)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.Multiselect = multi != 0
	p.ExpiresAt, p.EndedAt = int64Ptr(exp), int64Ptr(ended)
	return &p, nil
}

// SetPollVotes makes uid's votes on a poll exactly answers (none takes every
// vote back), returning the answers that gained and lost uid's vote.
func (s *Store) SetPollVotes(ctx context.Context, msgID, uid ids.ID, answers []int, now int64) (added, removed []int, err error) {
	err = s.Tx(ctx, func(tx *db.Tx) error {
		added, removed = nil, nil
		if err := tx.Serialise(ctx, "poll", int64(msgID)); err != nil {
			return err
		}
		var count int
		var multi int64
		var exp, ended sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT options_count, multiselect, expires_at, ended_at FROM polls WHERE message_id = ?`, int64(msgID)).Scan(&count, &multi, &exp, &ended); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if ended.Valid || (exp.Valid && exp.Int64 <= now) {
			return ErrPollClosed
		}
		want := map[int]bool{}
		for _, a := range answers {
			if a < 1 || a > count {
				return ErrBadVote
			}
			want[a] = true
		}
		if multi == 0 && len(want) > 1 {
			return ErrBadVote
		}
		rows, err := tx.QueryContext(ctx, `SELECT option_index FROM poll_votes WHERE message_id = ? AND user_id = ?`, int64(msgID), int64(uid))
		if err != nil {
			return err
		}
		have := map[int]bool{}
		for rows.Next() {
			var a int
			if err := rows.Scan(&a); err != nil {
				rows.Close()
				return err
			}
			have[a] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for a := range have {
			if !want[a] {
				if _, err := tx.ExecContext(ctx, `DELETE FROM poll_votes WHERE message_id = ? AND user_id = ? AND option_index = ?`, int64(msgID), int64(uid), a); err != nil {
					return err
				}
				removed = append(removed, a)
			}
		}
		for a := range want {
			if !have[a] {
				if _, err := tx.ExecContext(ctx, `INSERT INTO poll_votes (message_id, user_id, option_index) VALUES (?,?,?)`, int64(msgID), int64(uid), a); err != nil {
					return err
				}
				added = append(added, a)
			}
		}
		return nil
	})
	sort.Ints(added)
	sort.Ints(removed)
	return added, removed, err
}

// PollVoters lists who picked one answer, by id, after the id given.
func (s *Store) PollVoters(ctx context.Context, msgID ids.ID, answer int, after ids.ID, limit int) ([]ids.ID, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	return s.idList(ctx, `SELECT user_id FROM poll_votes WHERE message_id = ? AND option_index = ? AND user_id > ? ORDER BY user_id LIMIT ?`, int64(msgID), answer, int64(after), limit)
}

// DuePoll is a poll whose time has run out and whose result is not out yet.
type DuePoll struct {
	MessageID ids.ID
	ChannelID ids.ID
}

// DuePolls lists polls that ran out by now and have not been closed.
func (s *Store) DuePolls(ctx context.Context, now int64, limit int) ([]DuePoll, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT p.message_id, m.channel_id FROM polls p JOIN messages m ON m.id = p.message_id
		WHERE p.ended_at IS NULL AND p.expires_at IS NOT NULL AND p.expires_at <= ? ORDER BY p.expires_at LIMIT ?`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuePoll
	for rows.Next() {
		var d DuePoll
		if err := rows.Scan(&d.MessageID, &d.ChannelID); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// EndPoll closes a poll at now. It reports whether this call closed it, so
// that of two processes sweeping at once only one posts the result.
func (s *Store) EndPoll(ctx context.Context, msgID ids.ID, now int64) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE polls SET ended_at = ? WHERE message_id = ? AND ended_at IS NULL`, now, int64(msgID))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// hydratePolls fills the tallies of the polls among msgs, for forUser.
func (s *Store) hydratePolls(ctx context.Context, msgs []*Message, forUser ids.ID) error {
	byID := map[ids.ID]*Message{}
	var list []ids.ID
	for _, m := range msgs {
		if m.WebhookID != nil {
			byID[m.ID] = m
			list = append(list, m.ID)
		}
	}
	if len(list) == 0 {
		return nil
	}
	ph := placeholders(len(list))
	rows, err := s.db.R.QueryContext(ctx, `SELECT message_id, options_count, expires_at, ended_at FROM polls WHERE message_id IN (`+ph+`)`, idArgs(list)...)
	if err != nil {
		return err
	}
	now := nowMs()
	var withPoll []ids.ID
	for rows.Next() {
		var mid int64
		var count int
		var exp, ended sql.NullInt64
		if err := rows.Scan(&mid, &count, &exp, &ended); err != nil {
			rows.Close()
			return err
		}
		m := byID[ids.ID(mid)]
		if m == nil {
			continue
		}
		t := &PollTally{Counts: make([]PollCount, count), ExpiresAt: int64Ptr(exp)}
		for i := range t.Counts {
			t.Counts[i].ID = i + 1
		}
		t.Finalized = ended.Valid || (exp.Valid && exp.Int64 <= now)
		m.Poll = t
		withPoll = append(withPoll, m.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(withPoll) == 0 {
		return nil
	}
	ph = placeholders(len(withPoll))
	args := append([]any{int64(forUser)}, idArgs(withPoll)...)
	vrows, err := s.db.R.QueryContext(ctx, `SELECT message_id, option_index, count(*), max(CASE WHEN user_id = ? THEN 1 ELSE 0 END) FROM poll_votes WHERE message_id IN (`+ph+`) GROUP BY message_id, option_index`, args...)
	if err != nil {
		return err
	}
	for vrows.Next() {
		var mid int64
		var answer, n, me int
		if err := vrows.Scan(&mid, &answer, &n, &me); err != nil {
			vrows.Close()
			return err
		}
		if m := byID[ids.ID(mid)]; m != nil && m.Poll != nil && answer >= 1 && answer <= len(m.Poll.Counts) {
			m.Poll.Counts[answer-1].Count = n
			m.Poll.Counts[answer-1].MeVoted = me == 1
		}
	}
	vrows.Close()
	if err := vrows.Err(); err != nil {
		return err
	}
	trows, err := s.db.R.QueryContext(ctx, `SELECT message_id, count(DISTINCT user_id) FROM poll_votes WHERE message_id IN (`+ph+`) GROUP BY message_id`, idArgs(withPoll)...)
	if err != nil {
		return err
	}
	defer trows.Close()
	for trows.Next() {
		var mid int64
		var n int
		if err := trows.Scan(&mid, &n); err != nil {
			return err
		}
		if m := byID[ids.ID(mid)]; m != nil && m.Poll != nil {
			m.Poll.Voters = n
		}
	}
	return trows.Err()
}
