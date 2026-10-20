package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// MaxWebhooksPerChannel is how many webhooks one channel can have, and
// MaxWebhooksPerServer how many a whole server can; Discord's caps.
const (
	MaxWebhooksPerChannel = 15
	MaxWebhooksPerServer  = 1000
)

// WebhookUsername is the author account's username. It has a hyphen in it,
// which no username anyone registers or changes to can have.
const WebhookUsername = "nexa-webhook"

const webhookCols = `id, type, server_id, channel_id, creator_id, name, avatar_id, token_hash, token_sealed, created_at, updated_at`

func scanWebhook(r rowScanner) (*Webhook, error) {
	var w Webhook
	var creator, avatar sql.NullInt64
	if err := r.Scan(&w.ID, &w.Type, &w.ServerID, &w.ChannelID, &creator, &w.Name, &avatar, &w.TokenHash, &w.TokenSealed, &w.CreatedAt, &w.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	w.CreatorID, w.AvatarID = idPtr(creator), idPtr(avatar)
	return &w, nil
}

func (s *Store) queryWebhooks(ctx context.Context, q string, args ...any) ([]*Webhook, error) {
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Webhook{}
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateWebhook stores w, refusing with ErrTooMany once its channel or its
// server has as many as they can hold. The caller already holds a reference
// on the avatar, if there is one.
func (s *Store) CreateWebhook(ctx context.Context, w *Webhook) error {
	if w.ID.IsZero() {
		w.ID = ids.New()
	}
	if w.Type == 0 {
		w.Type = 1
	}
	now := nowMs()
	w.CreatedAt, w.UpdatedAt = now, now
	return s.Tx(ctx, func(tx *db.Tx) error {
		// counted and then added to, so the server is this transaction's alone
		if err := tx.Serialise(ctx, "webhooks", int64(w.ServerID)); err != nil {
			return err
		}
		var inChannel, inServer int
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM webhooks WHERE channel_id = ?), (SELECT count(*) FROM webhooks WHERE server_id = ?)`,
			int64(w.ChannelID), int64(w.ServerID)).Scan(&inChannel, &inServer); err != nil {
			return err
		}
		if inChannel >= MaxWebhooksPerChannel || inServer >= MaxWebhooksPerServer {
			return ErrTooMany
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO webhooks (`+webhookCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			int64(w.ID), w.Type, int64(w.ServerID), int64(w.ChannelID), nullID(w.CreatorID), w.Name, nullID(w.AvatarID), w.TokenHash, w.TokenSealed, w.CreatedAt, w.UpdatedAt)
		return err
	})
}

// WebhookByID loads one webhook.
func (s *Store) WebhookByID(ctx context.Context, id ids.ID) (*Webhook, error) {
	return scanWebhook(s.db.R.QueryRowContext(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE id = ?`, int64(id)))
}

// WebhooksByServer lists a server's webhooks, oldest first.
func (s *Store) WebhooksByServer(ctx context.Context, serverID ids.ID) ([]*Webhook, error) {
	return s.queryWebhooks(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE server_id = ? ORDER BY id`, int64(serverID))
}

// WebhooksByChannel lists a channel's webhooks, oldest first.
func (s *Store) WebhooksByChannel(ctx context.Context, channelID ids.ID) ([]*Webhook, error) {
	return s.queryWebhooks(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE channel_id = ? ORDER BY id`, int64(channelID))
}

// UpdateWebhook applies p. Moving a webhook to another channel is held to the
// same cap creating one there is.
func (s *Store) UpdateWebhook(ctx context.Context, id ids.ID, p WebhookPatch) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var serverID, channelID int64
		if err := tx.QueryRowContext(ctx, `SELECT server_id, channel_id FROM webhooks WHERE id = ?`, int64(id)).Scan(&serverID, &channelID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if p.ChannelID != nil && int64(*p.ChannelID) != channelID {
			if err := tx.Serialise(ctx, "webhooks", serverID); err != nil {
				return err
			}
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM webhooks WHERE channel_id = ?`, int64(*p.ChannelID)).Scan(&n); err != nil {
				return err
			}
			if n >= MaxWebhooksPerChannel {
				return ErrTooMany
			}
			if _, err := tx.ExecContext(ctx, `UPDATE webhooks SET channel_id = ? WHERE id = ?`, int64(*p.ChannelID), int64(id)); err != nil {
				return err
			}
		}
		if p.Name != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE webhooks SET name = ? WHERE id = ?`, *p.Name, int64(id)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE webhooks SET updated_at = ? WHERE id = ?`, nowMs(), int64(id))
		return err
	})
}

// DeleteWebhook removes a webhook and gives back its avatar's reference. The
// messages it sent stay, as they were sent.
func (s *Store) DeleteWebhook(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var avatar sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT avatar_id FROM webhooks WHERE id = ?`, int64(id)).Scan(&avatar); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM webhooks WHERE id = ?`, int64(id)); err != nil {
			return err
		}
		if avatar.Valid {
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, avatar.Int64); err != nil {
				return err
			}
		}
		return nil
	})
}

// WebhookUser returns the account webhook messages are filed under, or
// ErrNotFound before the first webhook has made it.
func (s *Store) WebhookUser(ctx context.Context) (*User, error) {
	return scanUser(s.db.R.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE flags & ? != 0 ORDER BY id LIMIT 1`, FlagWebhook))
}

// WebhookMessageEdit is a webhook's change to one of its own messages: what
// it says now, whom that pings, and which files it keeps and adds. Keep lists
// the attachment ids to keep; nil keeps them all.
type WebhookMessageEdit struct {
	Plain           json.RawMessage
	Flags           int64
	Mentions        []ids.ID
	MentionRoles    []ids.ID
	MentionEveryone bool
	Keep            []ids.ID
	Add             []Attachment
	// EditedAt is when it was edited; 0 leaves the message's edited time as
	// it was (an app filling in an answer it said it was still thinking about)
	EditedAt int64
}

// EditWebhookMessage rewrites a webhook's or a bot's message in one write: its content,
// mentions and flags (the pinned bit is kept), and its files, taking the ones
// dropped out (with their blob references) and adding new ones.
func (s *Store) EditWebhookMessage(ctx context.Context, id ids.ID, e WebhookMessageEdit) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var chID, author int64
		var webhook sql.NullInt64
		var plain, ct sql.NullString
		var typ string
		if err := tx.QueryRowContext(ctx, `SELECT channel_id, author_id, webhook_id, plain, ciphertext, type FROM messages WHERE id = ?`, int64(id)).Scan(&chID, &author, &webhook, &plain, &ct, &typ); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		// a webhook's message, or a bot's: words kept in the clear
		if !webhook.Valid && !(plain.Valid && !ct.Valid && (typ == "default" || typ == "reply")) {
			return ErrNotFound
		}
		if e.Keep != nil {
			keep := map[int64]bool{}
			for _, k := range e.Keep {
				keep[int64(k)] = true
			}
			rows, err := tx.QueryContext(ctx, `SELECT id FROM attachments WHERE message_id = ?`, int64(id))
			if err != nil {
				return err
			}
			var drop []int64
			for rows.Next() {
				var aid int64
				if err := rows.Scan(&aid); err != nil {
					rows.Close()
					return err
				}
				if !keep[aid] {
					drop = append(drop, aid)
				}
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			for _, aid := range drop {
				if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = (SELECT blob_id FROM attachments WHERE id = ?)`, aid); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `DELETE FROM attachments WHERE id = ?`, aid); err != nil {
					return err
				}
			}
		}
		for i := range e.Add {
			a := &e.Add[i]
			if a.ID.IsZero() {
				a.ID = ids.New()
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO attachments (id, message_id, channel_id, uploader_id, blob_id, size, created_at) VALUES (?,?,?,?,?,?,?)`,
				int64(a.ID), int64(id), chID, author, int64(a.BlobID), a.Size, time.Now().UnixMilli()); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?`, int64(a.BlobID)); err != nil {
				return err
			}
		}
		var left int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM attachments WHERE message_id = ?`, int64(id)).Scan(&left); err != nil {
			return err
		}
		var edited any
		if e.EditedAt != 0 {
			edited = e.EditedAt
		}
		_, err := tx.ExecContext(ctx, `UPDATE messages SET plain = ?, flags = (flags & ?) | ?, mentions = ?, mention_roles = ?, mention_everyone = ?, has_attachments = ?, edited_at = COALESCE(?, edited_at) WHERE id = ?`,
			string(e.Plain), MsgFlagPinned, e.Flags&^MsgFlagPinned, idsJSON(e.Mentions), idsJSON(e.MentionRoles), boolInt(e.MentionEveryone), boolInt(left > 0), edited, int64(id))
		return err
	})
}

// SetWebhookPlain replaces what a webhook's or a bot's message holds without
// calling it an edit: the link previews the server fetched for it afterwards.
func (s *Store) SetWebhookPlain(ctx context.Context, id ids.ID, plain json.RawMessage) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE messages SET plain = ? WHERE id = ? AND (webhook_id IS NOT NULL OR (plain IS NOT NULL AND ciphertext IS NULL AND type IN ('default', 'reply')))`, string(plain), int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
