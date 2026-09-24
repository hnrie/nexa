package store

import (
	"context"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// A moderator deleting an account takes everything it made with it — unlike
// someone deleting their own, where the messages stay behind under Deleted
// User. The api package runs the steps in order, telling everyone as each
// lands; these are the pieces it runs them with. Every one of them can be run
// again after a failure part way, and finds only what is left.

// PurgeCounts is what deleting an account would take with it, shown to the
// moderator before they confirm.
type PurgeCounts struct {
	Messages        int   `json:"messages"`
	Attachments     int   `json:"attachments"`
	AttachmentBytes int64 `json:"attachment_bytes"`
	OwnedServers    int   `json:"owned_servers"`
	OwnedGroups     int   `json:"owned_groups"`
	Servers         int   `json:"servers"`
	Groups          int   `json:"groups"`
	Packs           int   `json:"packs"`
	Reactions       int   `json:"reactions"`
}

// PurgePreview counts what deleting the account would remove.
func (s *Store) PurgePreview(ctx context.Context, uid ids.ID) (PurgeCounts, error) {
	var c PurgeCounts
	id := int64(uid)
	err := s.db.R.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM messages WHERE author_id = ?),
		(SELECT count(*) FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.author_id = ?),
		(SELECT coalesce(sum(a.size), 0) FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.author_id = ?),
		(SELECT count(*) FROM servers WHERE owner_id = ?),
		(SELECT count(*) FROM channels WHERE type = 'group_dm' AND owner_id = ?),
		(SELECT count(*) FROM server_members WHERE user_id = ?),
		(SELECT count(*) FROM dm_participants p JOIN channels c ON c.id = p.channel_id WHERE p.user_id = ? AND c.type = 'group_dm'),
		(SELECT count(*) FROM sticker_packs WHERE owner_user_id = ?),
		(SELECT count(*) FROM reactions WHERE user_id = ?)`,
		id, id, id, id, id, id, id, id, id).Scan(&c.Messages, &c.Attachments, &c.AttachmentBytes, &c.OwnedServers, &c.OwnedGroups, &c.Servers, &c.Groups, &c.Packs, &c.Reactions)
	return c, err
}

// PurgeUserMessages deletes up to batch of the account's messages, from every
// channel, in one transaction, releasing their attachments and fixing each
// channel's newest message. It returns what it deleted, by channel; an empty
// map means there is nothing left. Batches keep one account's history from
// holding the database's only writer for as long as the whole of it takes.
func (s *Store) PurgeUserMessages(ctx context.Context, uid ids.ID, batch int) (map[ids.ID][]ids.ID, error) {
	if batch <= 0 {
		batch = 500
	}
	out := map[ids.ID][]ids.ID{}
	err := s.Tx(ctx, func(tx *db.Tx) error {
		clear(out)
		rows, err := tx.QueryContext(ctx, `SELECT id, channel_id FROM messages WHERE author_id = ? ORDER BY id LIMIT ?`, int64(uid), batch)
		if err != nil {
			return err
		}
		var order []ids.ID
		for rows.Next() {
			var id, ch int64
			if err := rows.Scan(&id, &ch); err != nil {
				rows.Close()
				return err
			}
			out[ids.ID(ch)] = append(out[ids.ID(ch)], ids.ID(id))
			order = append(order, ids.ID(id))
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range order {
			if err := deleteMessageTx(ctx, tx, id); err != nil {
				return err
			}
		}
		for ch := range out {
			if err := fixLastMessageTx(ctx, tx, ch); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ReactionRef locates one reaction, for telling its channel it went.
type ReactionRef struct {
	ChannelID ids.ID
	MessageID ids.ID
	Emoji     string
}

// PurgeUserReactions removes every reaction the account left and returns
// where they were, up to limit of them, so open channels can be told.
func (s *Store) PurgeUserReactions(ctx context.Context, uid ids.ID, limit int) ([]ReactionRef, error) {
	var out []ReactionRef
	err := s.Tx(ctx, func(tx *db.Tx) error {
		out = out[:0]
		rows, err := tx.QueryContext(ctx, `SELECT m.channel_id, r.message_id, r.emoji FROM reactions r JOIN messages m ON m.id = r.message_id WHERE r.user_id = ? LIMIT ?`, int64(uid), limit)
		if err != nil {
			return err
		}
		for rows.Next() {
			var ref ReactionRef
			if err := rows.Scan(&ref.ChannelID, &ref.MessageID, &ref.Emoji); err != nil {
				rows.Close()
				return err
			}
			out = append(out, ref)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM reactions WHERE user_id = ?`, int64(uid))
		return err
	})
	return out, err
}

// OwnedConversations lists the group DMs and subchats the account owns, which
// go with it rather than passing to somebody else.
func (s *Store) OwnedConversations(ctx context.Context, uid ids.ID) ([]*Channel, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id FROM channels WHERE owner_id = ? AND type IN ('group_dm', 'subchat') ORDER BY CASE type WHEN 'subchat' THEN 0 ELSE 1 END, id`, int64(uid))
	if err != nil {
		return nil, err
	}
	var list []ids.ID
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, ids.ID(id))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]*Channel, 0, len(list))
	for _, id := range list {
		ch, err := s.ChannelByID(ctx, id)
		if errors.Is(err, ErrNotFound) {
			// a subchat that went with its group a step earlier
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, nil
}

// PacksOwnedBy lists the sticker and emoji packs an account owns.
func (s *Store) PacksOwnedBy(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	return s.idList(ctx, `SELECT id FROM sticker_packs WHERE owner_user_id = ?`, int64(uid))
}

// UploadsOf lists an account's unfinished uploads.
func (s *Store) UploadsOf(ctx context.Context, uid ids.ID) ([]ids.ID, error) {
	return s.idList(ctx, `SELECT id FROM uploads WHERE user_id = ?`, int64(uid))
}

func (s *Store) idList(ctx context.Context, q string, args ...any) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ids.ID
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, ids.ID(id))
	}
	return out, rows.Err()
}

// PurgeUserLeftovers removes what the other steps do not reach: poll votes,
// the invites and guest links it made, its unfinished uploads, its read
// positions, recent stickers and installed packs, its per-server avatars
// (whose pictures are let go), and its Nexa read position.
func (s *Store) PurgeUserLeftovers(ctx context.Context, uid ids.ID) error {
	id := int64(uid)
	return s.Tx(ctx, func(tx *db.Tx) error {
		if err := releaseBlobRefs(ctx, tx, `SELECT avatar_id FROM server_members WHERE user_id = ? AND avatar_id IS NOT NULL`, id); err != nil {
			return err
		}
		for _, q := range []string{
			`UPDATE server_members SET avatar_id = NULL WHERE user_id = ?`,
			`DELETE FROM poll_votes WHERE user_id = ?`,
			`DELETE FROM invites WHERE inviter_id = ?`,
			`DELETE FROM guest_links WHERE creator_id = ?`,
			`DELETE FROM uploads WHERE user_id = ?`,
			`DELETE FROM read_states WHERE user_id = ?`,
			`DELETE FROM recent_stickers WHERE user_id = ?`,
			`DELETE FROM sticker_installs WHERE user_id = ?`,
			`DELETE FROM nexa_reads WHERE user_id = ?`,
		} {
			if _, err := tx.ExecContext(ctx, q, id); err != nil {
				return err
			}
		}
		return nil
	})
}
