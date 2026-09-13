package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"evilion.xyz/chat/internal/ids"
)

// ErrLimit is returned when a per-object cap is reached.
var ErrLimit = errors.New("limit reached")

// MaxReactionEmoji caps distinct emoji per message.
const MaxReactionEmoji = 20

const messageCols = `id, channel_id, author_id, type, ciphertext, key_conv_id, key_epoch, reply_to_id, mentions, mention_roles, mention_everyone, has_attachments, flags, nonce, edited_at, created_at`

// messageColsM is messageCols qualified with the alias m, for joins.
const messageColsM = `m.id, m.channel_id, m.author_id, m.type, m.ciphertext, m.key_conv_id, m.key_epoch, m.reply_to_id, m.mentions, m.mention_roles, m.mention_everyone, m.has_attachments, m.flags, m.nonce, m.edited_at, m.created_at`

// MessageQuery selects a page of messages. Results are always ascending by id.
type MessageQuery struct {
	Before ids.ID
	After  ids.ID
	Around ids.ID
	Limit  int
}

func idsJSON(list []ids.ID) string {
	if len(list) == 0 {
		return "[]"
	}
	strs := make([]string, len(list))
	for i, id := range list {
		strs[i] = id.String()
	}
	b, _ := json.Marshal(strs)
	return string(b)
}

func parseIDsJSON(s string) []ids.ID {
	var strs []string
	if err := json.Unmarshal([]byte(s), &strs); err != nil {
		return []ids.ID{}
	}
	out := make([]ids.ID, 0, len(strs))
	for _, v := range strs {
		if id, err := ids.Parse(v); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func scanMessage(r rowScanner) (*Message, error) {
	var m Message
	var ct sql.NullString
	var conv, epoch, reply, edited sql.NullInt64
	var mentions, roles string
	var everyone, hasAtt int64
	var nonce sql.NullString
	if err := r.Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Type, &ct, &conv, &epoch, &reply, &mentions, &roles, &everyone, &hasAtt, &m.Flags, &nonce, &edited, &m.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if ct.Valid {
		m.Ciphertext = json.RawMessage(ct.String)
	} else {
		m.Ciphertext = json.RawMessage("null")
	}
	m.KeyConvID = idPtr(conv)
	m.KeyEpoch = intPtr(epoch)
	m.ReplyToID = idPtr(reply)
	m.EditedAt = int64Ptr(edited)
	m.Mentions = parseIDsJSON(mentions)
	m.MentionRoles = parseIDsJSON(roles)
	m.MentionEveryone = everyone == 1
	m.Nonce = nonce.String
	m.Attachments = []Attachment{}
	m.Reactions = []ReactionSummary{}
	return &m, nil
}

// InsertMessage stores m with its attachments, bumps the channel's last
// message and references attachment blobs. A duplicate nonce returns
// ErrAlreadyExists.
func (s *Store) InsertMessage(ctx context.Context, m *Message) error {
	if m.ID.IsZero() {
		m.ID = ids.New()
	}
	if m.CreatedAt == 0 {
		m.CreatedAt = m.ID.Time().UnixMilli()
	}
	if m.Type == "" {
		m.Type = "default"
	}
	var ct any
	if len(m.Ciphertext) > 0 && string(m.Ciphertext) != "null" {
		ct = string(m.Ciphertext)
	}
	var nonce any
	if m.Nonce != "" {
		nonce = m.Nonce
	}
	var epoch any
	if m.KeyEpoch != nil {
		epoch = int64(*m.KeyEpoch)
	}
	return s.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT INTO messages (`+messageCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel_id, author_id, nonce) WHERE nonce IS NOT NULL DO NOTHING`,
			int64(m.ID), int64(m.ChannelID), int64(m.AuthorID), m.Type, ct, nullID(m.KeyConvID), epoch, nullID(m.ReplyToID), idsJSON(m.Mentions), idsJSON(m.MentionRoles), boolInt(m.MentionEveryone), boolInt(len(m.Attachments) > 0), m.Flags, nonce, nullInt64(m.EditedAt), m.CreatedAt)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrAlreadyExists
		}
		for i := range m.Attachments {
			a := &m.Attachments[i]
			if a.ID.IsZero() {
				a.ID = ids.New()
			}
			a.MessageID, a.ChannelID, a.CreatedAt = m.ID, m.ChannelID, m.CreatedAt
			if _, err := tx.ExecContext(ctx, `INSERT INTO attachments (id, message_id, channel_id, uploader_id, blob_id, size, created_at) VALUES (?,?,?,?,?,?,?)`, int64(a.ID), int64(m.ID), int64(m.ChannelID), int64(m.AuthorID), int64(a.BlobID), a.Size, m.CreatedAt); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?`, int64(a.BlobID)); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE channels SET last_message_id = max(coalesce(last_message_id, 0), ?) WHERE id = ?`, int64(m.ID), int64(m.ChannelID))
		return err
	})
}

// MessageByNonce finds the message a duplicate send refers to.
func (s *Store) MessageByNonce(ctx context.Context, chID, author ids.ID, nonce string, forUser ids.ID) (*Message, error) {
	m, err := scanMessage(s.db.R.QueryRowContext(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? AND author_id = ? AND nonce = ?`, int64(chID), int64(author), nonce))
	if err != nil {
		return nil, err
	}
	if err := s.hydrate(ctx, []*Message{m}, forUser); err != nil {
		return nil, err
	}
	return m, nil
}

// MessageByID loads one message with attachments and reactions.
func (s *Store) MessageByID(ctx context.Context, id ids.ID, forUser ids.ID) (*Message, error) {
	m, err := scanMessage(s.db.R.QueryRowContext(ctx, `SELECT `+messageCols+` FROM messages WHERE id = ?`, int64(id)))
	if err != nil {
		return nil, err
	}
	if err := s.hydrate(ctx, []*Message{m}, forUser); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Store) queryMessages(ctx context.Context, q string, args ...any) ([]*Message, error) {
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Messages returns a page of a channel's messages, ascending by id.
func (s *Store) Messages(ctx context.Context, chID ids.ID, q MessageQuery, forUser ids.ID) ([]*Message, error) {
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var list []*Message
	var err error
	switch {
	case !q.Around.IsZero():
		half := limit / 2
		before, err := s.queryMessages(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?`, int64(chID), int64(q.Around), half)
		if err != nil {
			return nil, err
		}
		after, err := s.queryMessages(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? AND id >= ? ORDER BY id ASC LIMIT ?`, int64(chID), int64(q.Around), limit-half)
		if err != nil {
			return nil, err
		}
		list = append(before, after...)
	case !q.After.IsZero():
		list, err = s.queryMessages(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?`, int64(chID), int64(q.After), limit)
	case !q.Before.IsZero():
		list, err = s.queryMessages(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?`, int64(chID), int64(q.Before), limit)
	default:
		list, err = s.queryMessages(ctx, `SELECT `+messageCols+` FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?`, int64(chID), limit)
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	if list == nil {
		list = []*Message{}
	}
	if err := s.hydrate(ctx, list, forUser); err != nil {
		return nil, err
	}
	return list, nil
}

// hydrate fills attachments and reaction summaries for msgs.
func (s *Store) hydrate(ctx context.Context, msgs []*Message, forUser ids.ID) error {
	if len(msgs) == 0 {
		return nil
	}
	byID := make(map[ids.ID]*Message, len(msgs))
	list := make([]ids.ID, 0, len(msgs))
	for _, m := range msgs {
		byID[m.ID] = m
		list = append(list, m.ID)
	}
	ph := placeholders(len(list))
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, message_id, channel_id, uploader_id, blob_id, size, created_at FROM attachments WHERE message_id IN (`+ph+`) ORDER BY id`, idArgs(list)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.MessageID, &a.ChannelID, &a.UploaderID, &a.BlobID, &a.Size, &a.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		if m := byID[a.MessageID]; m != nil {
			m.Attachments = append(m.Attachments, a)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	args := append([]any{int64(forUser)}, idArgs(list)...)
	rrows, err := s.db.R.QueryContext(ctx, `SELECT message_id, emoji, count(*), max(user_id = ?) FROM reactions WHERE message_id IN (`+ph+`) GROUP BY message_id, emoji ORDER BY min(created_at), min(rowid)`, args...)
	if err != nil {
		return err
	}
	defer rrows.Close()
	for rrows.Next() {
		var mid int64
		var rs ReactionSummary
		var me int64
		if err := rrows.Scan(&mid, &rs.Emoji, &rs.Count, &me); err != nil {
			return err
		}
		rs.Me = me == 1
		if m := byID[ids.ID(mid)]; m != nil {
			m.Reactions = append(m.Reactions, rs)
		}
	}
	return rrows.Err()
}

// UpdateMessage replaces the ciphertext and mention metadata.
func (s *Store) UpdateMessage(ctx context.Context, id ids.ID, ciphertext json.RawMessage, keyConv ids.ID, keyEpoch int, mentions, roles []ids.ID, everyone bool, editedAt int64) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE messages SET ciphertext = ?, key_conv_id = ?, key_epoch = ?, mentions = ?, mention_roles = ?, mention_everyone = ?, edited_at = ? WHERE id = ?`, string(ciphertext), int64(keyConv), keyEpoch, idsJSON(mentions), idsJSON(roles), boolInt(everyone), editedAt, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetMessageFlags overwrites the flags bitfield.
func (s *Store) SetMessageFlags(ctx context.Context, id ids.ID, flags int64) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE messages SET flags = ? WHERE id = ?`, flags, int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteMessage removes a message, releasing attachment blobs and fixing the
// channel's last_message_id.
func (s *Store) DeleteMessage(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		var chID int64
		if err := tx.QueryRowContext(ctx, `SELECT channel_id FROM messages WHERE id = ?`, int64(id)).Scan(&chID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		// one reference per attachment row, however many rows share a blob
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = max(0, ref_count - (SELECT count(*) FROM attachments a WHERE a.message_id = ? AND a.blob_id = blobs.id)) WHERE id IN (SELECT blob_id FROM attachments WHERE message_id = ?)`, int64(id), int64(id)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM messages WHERE id = ?`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE channels SET last_message_id = (SELECT max(id) FROM messages WHERE channel_id = ?) WHERE id = ? AND last_message_id = ?`, chID, chID, int64(id))
		return err
	})
}

// AddReaction records a reaction; added is false when it already existed.
func (s *Store) AddReaction(ctx context.Context, msgID, uid ids.ID, emoji string) (added bool, err error) {
	err = s.Tx(ctx, func(tx *sql.Tx) error {
		var distinct, present int
		if err := tx.QueryRowContext(ctx, `SELECT count(DISTINCT emoji), coalesce(sum(emoji = ?), 0) FROM reactions WHERE message_id = ?`, emoji, int64(msgID)).Scan(&distinct, &present); err != nil {
			return err
		}
		if present == 0 && distinct >= MaxReactionEmoji {
			return ErrLimit
		}
		res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)`, int64(msgID), int64(uid), emoji, nowMs())
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		added = n > 0
		return nil
	})
	return added, err
}

// RemoveReaction deletes a reaction; removed is false when it did not exist.
func (s *Store) RemoveReaction(ctx context.Context, msgID, uid ids.ID, emoji string) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`, int64(msgID), int64(uid), emoji)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Reactors lists who reacted with emoji, oldest first.
func (s *Store) Reactors(ctx context.Context, msgID ids.ID, emoji string, limit int) ([]ids.ID, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM reactions WHERE message_id = ? AND emoji = ? ORDER BY created_at, rowid LIMIT ?`, int64(msgID), emoji, limit)
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

// PinMessage pins a message in its channel.
func (s *Store) PinMessage(ctx context.Context, chID, msgID, by ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO pins (channel_id, message_id, pinned_by, pinned_at) VALUES (?,?,?,?)`, int64(chID), int64(msgID), int64(by), nowMs())
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrAlreadyExists
		}
		_, err = tx.ExecContext(ctx, `UPDATE messages SET flags = flags | ? WHERE id = ? AND channel_id = ?`, MsgFlagPinned, int64(msgID), int64(chID))
		return err
	})
}

// UnpinMessage removes a pin.
func (s *Store) UnpinMessage(ctx context.Context, chID, msgID ids.ID) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM pins WHERE channel_id = ? AND message_id = ?`, int64(chID), int64(msgID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.ExecContext(ctx, `UPDATE messages SET flags = flags & ~? WHERE id = ?`, MsgFlagPinned, int64(msgID))
		return err
	})
}

// Pins lists pinned messages, most recently pinned first.
func (s *Store) Pins(ctx context.Context, chID ids.ID, forUser ids.ID) ([]*Message, error) {
	list, err := s.queryMessages(ctx, `SELECT `+messageColsM+` FROM messages m JOIN pins p ON p.message_id = m.id WHERE p.channel_id = ? ORDER BY p.pinned_at DESC LIMIT 500`, int64(chID))
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []*Message{}
	}
	if err := s.hydrate(ctx, list, forUser); err != nil {
		return nil, err
	}
	return list, nil
}

// CountPins returns how many messages are pinned in a channel.
func (s *Store) CountPins(ctx context.Context, chID ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM pins WHERE channel_id = ?`, int64(chID)).Scan(&n)
	return n, err
}

// AttachmentByBlob finds the attachment row that owns a blob, if any.
func (s *Store) AttachmentByBlob(ctx context.Context, blobID ids.ID) (*Attachment, error) {
	var a Attachment
	err := s.db.R.QueryRowContext(ctx, `SELECT id, message_id, channel_id, uploader_id, blob_id, size, created_at FROM attachments WHERE blob_id = ? LIMIT 1`, int64(blobID)).Scan(&a.ID, &a.MessageID, &a.ChannelID, &a.UploaderID, &a.BlobID, &a.Size, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// DeleteMessagesByUserSince removes a user's recent messages in a server
// (ban with message purge). Returns the deleted ids per channel.
func (s *Store) DeleteMessagesByUserSince(ctx context.Context, serverID, uid ids.ID, since int64) (map[ids.ID][]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT m.id, m.channel_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = ? AND m.author_id = ? AND m.created_at >= ?`, int64(serverID), int64(uid), since)
	if err != nil {
		return nil, err
	}
	out := map[ids.ID][]ids.ID{}
	for rows.Next() {
		var id, ch int64
		if err := rows.Scan(&id, &ch); err != nil {
			rows.Close()
			return nil, err
		}
		out[ids.ID(ch)] = append(out[ids.ID(ch)], ids.ID(id))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, list := range out {
		for _, id := range list {
			if err := s.DeleteMessage(ctx, id); err != nil && err != ErrNotFound {
				return nil, err
			}
		}
	}
	return out, nil
}

// LastMessageAt returns the creation time of the newest user-authored message by uid in a channel (0 when none); system messages do not count.
func (s *Store) LastMessageAt(ctx context.Context, chID, uid ids.ID) (int64, error) {
	var t sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT max(created_at) FROM messages WHERE channel_id = ? AND author_id = ? AND type IN ('default', 'reply')`, int64(chID), int64(uid)).Scan(&t)
	if err != nil {
		return 0, err
	}
	return t.Int64, nil
}
