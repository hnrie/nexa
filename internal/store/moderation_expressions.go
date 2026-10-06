package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// Stickers and emoji in the moderation panel: every pack on Nexa, every
// server's emoji and the newest uploads, with what the staff can take down
// (internal/api/moderation_expressions.go). Their pictures are public by
// design, unlike anything said in a conversation, which the panel never sees.

// ModPack is a pack as the panel lists it.
type ModPack struct {
	StickerPack
	StickerCount int `json:"sticker_count"`
	Installs     int `json:"installs"`
	// DiscoverBlocked says the staff took it out of Discover, where it stays
	// until they let it back.
	DiscoverBlocked bool `json:"discover_blocked"`
}

// ModPackFilter narrows the panel's list of packs.
type ModPackFilter struct {
	Query string
	// Scope is all, discover (public), personal, server, or hidden (taken out
	// of Discover).
	Scope    string
	Sort     string // newest | oldest | installs | name
	OwnerID  *ids.ID
	ServerID *ids.ID
	Offset   int
	Limit    int
	// Preview is how many of each pack's first stickers come with it.
	Preview int
}

const modPackSelect = `SELECT ` + `p.id, p.kind, p.owner_user_id, p.server_id, p.name, p.description, p.cover_sticker_id, p.public, p.created_at, p.updated_at,
	p.discover_blocked,
	(SELECT count(*) FROM stickers st WHERE st.pack_id = p.id),
	(SELECT count(*) FROM sticker_installs i WHERE i.pack_id = p.id)
	FROM sticker_packs p LEFT JOIN users u ON u.id = p.owner_user_id LEFT JOIN servers sv ON sv.id = p.server_id `

func scanModPack(r rowScanner) (*ModPack, error) {
	var m ModPack
	var owner, server, cover sql.NullInt64
	var public, blocked int64
	if err := r.Scan(&m.ID, &m.Kind, &owner, &server, &m.Name, &m.Description, &cover, &public, &m.CreatedAt, &m.UpdatedAt, &blocked, &m.StickerCount, &m.Installs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	m.OwnerUserID, m.ServerID, m.CoverStickerID = idPtr(owner), idPtr(server), idPtr(cover)
	m.Public, m.DiscoverBlocked = public == 1, blocked == 1
	m.Stickers = []*Sticker{}
	return &m, nil
}

// ModPacks lists packs for the panel, each with its first stickers.
func (s *Store) ModPacks(ctx context.Context, f ModPackFilter) ([]*ModPack, error) {
	var where []string
	var args []any
	switch f.Scope {
	case "discover":
		where = append(where, "p.public = 1")
	case "personal":
		where = append(where, "p.owner_user_id IS NOT NULL")
	case "server":
		where = append(where, "p.server_id IS NOT NULL")
	case "hidden":
		where = append(where, "p.discover_blocked = 1")
	}
	if f.OwnerID != nil {
		where = append(where, "p.owner_user_id = ?")
		args = append(args, int64(*f.OwnerID))
	}
	if f.ServerID != nil {
		where = append(where, "p.server_id = ?")
		args = append(args, int64(*f.ServerID))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		if len(q) > maxSearchQuery {
			q = q[:maxSearchQuery]
		}
		like := "%" + escapeLike(strings.ToLower(strings.TrimPrefix(q, "@"))) + "%"
		lower := s.db.Dialect.Lower
		cond := lower("p.name") + ` LIKE ? ESCAPE '\' OR ` + lower("p.description") + ` LIKE ? ESCAPE '\' OR ` + lower("u.username") + ` LIKE ? ESCAPE '\' OR ` + lower("u.display_name") + ` LIKE ? ESCAPE '\' OR ` + lower("sv.name") + ` LIKE ? ESCAPE '\'`
		args = append(args, like, like, like, like, like)
		// an ID finds the pack, its owner or its server
		if n, err := strconv.ParseInt(q, 10, 64); err == nil {
			cond += ` OR p.id = ? OR p.owner_user_id = ? OR p.server_id = ?`
			args = append(args, n, n, n)
		}
		where = append(where, "("+cond+")")
	}
	q := modPackSelect
	if len(where) > 0 {
		q += "WHERE " + strings.Join(where, " AND ") + " "
	}
	switch f.Sort {
	case "oldest":
		q += "ORDER BY p.created_at ASC, p.id ASC"
	case "installs":
		q += "ORDER BY (SELECT count(*) FROM sticker_installs i WHERE i.pack_id = p.id) DESC, p.created_at DESC, p.id DESC"
	case "name":
		q += "ORDER BY " + s.db.Dialect.Lower("p.name") + " ASC, p.id ASC"
	default:
		q += "ORDER BY p.created_at DESC, p.id DESC"
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	q += " LIMIT ? OFFSET ?"
	args = append(args, limit, max(f.Offset, 0))
	rows, err := s.db.R.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	out := []*ModPack{}
	for rows.Next() {
		m, err := scanModPack(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if f.Preview > 0 && len(out) > 0 {
		if err := s.previewStickers(ctx, out, f.Preview); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// previewStickers fills each pack with its first n stickers, in their order.
func (s *Store) previewStickers(ctx context.Context, packs []*ModPack, n int) error {
	byPack := make(map[ids.ID]*ModPack, len(packs))
	list := make([]ids.ID, 0, len(packs))
	for _, p := range packs {
		byPack[p.ID] = p
		list = append(list, p.ID)
	}
	return chunked(list, func(part []ids.ID) error {
		rows, err := s.db.R.QueryContext(ctx, `SELECT `+stickerCols+` FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.pack_id ORDER BY x.position, x.id) AS rn FROM stickers x WHERE x.pack_id IN (`+placeholders(len(part))+`)) s JOIN blobs b ON b.id = s.blob_id WHERE s.rn <= ? ORDER BY s.pack_id, s.position, s.id`, append(idArgs(part), n)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			st, err := scanSticker(rows)
			if err != nil {
				return err
			}
			if p := byPack[st.PackID]; p != nil {
				p.Stickers = append(p.Stickers, st)
			}
		}
		return rows.Err()
	})
}

// ModPackByID is one pack for the panel, with every sticker in it.
func (s *Store) ModPackByID(ctx context.Context, id ids.ID) (*ModPack, error) {
	m, err := scanModPack(s.db.R.QueryRowContext(ctx, modPackSelect+`WHERE p.id = ?`, int64(id)))
	if err != nil {
		return nil, err
	}
	if m.Stickers, err = s.PackStickers(ctx, id); err != nil {
		return nil, err
	}
	return m, nil
}

// PackDiscoverBlocked says whether the staff took a pack out of Discover.
func (s *Store) PackDiscoverBlocked(ctx context.Context, id ids.ID) (bool, error) {
	var blocked int64
	if err := s.db.R.QueryRowContext(ctx, `SELECT discover_blocked FROM sticker_packs WHERE id = ?`, int64(id)).Scan(&blocked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, err
	}
	return blocked == 1, nil
}

// ModUpload is one sticker or emoji among the newest uploads on Nexa.
type ModUpload struct {
	Kind     string `json:"kind"` // sticker | emoji
	ID       ids.ID `json:"id"`
	Name     string `json:"name"`
	BlobID   ids.ID `json:"blob_id"`
	Animated bool   `json:"animated"`
	// Format is a sticker's (png, gif, tgs, webm...).
	Format string `json:"format,omitempty"`
	// PackID and PackName are a sticker's pack.
	PackID   *ids.ID `json:"pack_id,omitempty"`
	PackName string  `json:"pack_name,omitempty"`
	// ServerID is an emoji's server, or the server whose pack a sticker is in;
	// OwnerID is the person whose pack it is.
	ServerID  *ids.ID `json:"server_id,omitempty"`
	OwnerID   *ids.ID `json:"owner_id,omitempty"`
	CreatorID ids.ID  `json:"creator_id"`
	CreatedAt int64   `json:"created_at"`
}

// ModRecentUploads lists stickers and emoji newest first, before a point in
// the list (zero for the start).
func (s *Store) ModRecentUploads(ctx context.Context, before int64, beforeID ids.ID, limit int) ([]*ModUpload, error) {
	if limit <= 0 || limit > 200 {
		limit = 120
	}
	if before <= 0 {
		before = 1<<62 - 1
	}
	rows, err := s.db.R.QueryContext(ctx, `SELECT kind, id, name, blob_id, animated, format, pack_id, pack_name, server_id, owner_id, creator_id, created_at FROM (
		SELECT 'sticker' AS kind, s.id, s.name, s.blob_id, b.animated, s.format, s.pack_id, p.name AS pack_name, p.server_id, p.owner_user_id AS owner_id, s.creator_id, s.created_at
			FROM stickers s JOIN blobs b ON b.id = s.blob_id JOIN sticker_packs p ON p.id = s.pack_id
		UNION ALL
		SELECT 'emoji' AS kind, e.id, e.name, e.blob_id, e.animated, '' AS format, CAST(NULL AS BIGINT) AS pack_id, '' AS pack_name, e.server_id, CAST(NULL AS BIGINT) AS owner_id, e.creator_id, e.created_at
			FROM emojis e
	) x WHERE x.created_at < ? OR (x.created_at = ? AND x.id < ?) ORDER BY x.created_at DESC, x.id DESC LIMIT ?`, before, before, int64(beforeID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ModUpload{}
	for rows.Next() {
		var u ModUpload
		var animated int64
		var pack, server, owner sql.NullInt64
		if err := rows.Scan(&u.Kind, &u.ID, &u.Name, &u.BlobID, &animated, &u.Format, &pack, &u.PackName, &server, &owner, &u.CreatorID, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Animated = animated == 1
		u.PackID, u.ServerID, u.OwnerID = idPtr(pack), idPtr(server), idPtr(owner)
		out = append(out, &u)
	}
	return out, rows.Err()
}

// ModExpressionTakedown is what one staff action takes down. Stickers are
// in Pack; emoji are in Server.
type ModExpressionTakedown struct {
	PackID   *ids.ID
	ServerID *ids.ID
	Stickers []ids.ID
	Emojis   []ids.ID
	// DeletePack takes the whole pack away, from everyone who installed it.
	DeletePack bool
	// Name is the pack's name in place of the one taken down.
	Name             *string
	ClearDescription bool
	// Unlist takes the pack out of Discover until the staff let it back.
	Unlist bool
	// Block blocks every picture taken down by its hash: no copy of it is
	// served any longer, and it cannot be uploaded again.
	Block bool
}

// ErrNotInPack means a sticker or emoji named in a takedown is not in the
// pack or server it was said to be in.
var ErrNotInPack = errors.New("not in that pack or server")

// ModTakeDownExpressions takes down what t names and opens its case, in one
// transaction: either all of it happens and is on record, or none of it.
func (s *Store) ModTakeDownExpressions(ctx context.Context, c *ModCase, t ModExpressionTakedown, log *ModLogEntry) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if err := openCaseTx(ctx, tx, c, log); err != nil {
			return err
		}
		var blobs []int64
		release := func(blob int64) error {
			blobs = append(blobs, blob)
			_, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, blob)
			return err
		}
		if t.PackID != nil {
			pack := int64(*t.PackID)
			for _, id := range t.Stickers {
				var blob int64
				if err := tx.QueryRowContext(ctx, `SELECT blob_id FROM stickers WHERE id = ? AND pack_id = ?`, int64(id), pack).Scan(&blob); err != nil {
					if errors.Is(err, sql.ErrNoRows) {
						return ErrNotInPack
					}
					return err
				}
				if _, err := tx.ExecContext(ctx, `DELETE FROM stickers WHERE id = ?`, int64(id)); err != nil {
					return err
				}
				if err := release(blob); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET cover_sticker_id = NULL WHERE id = ? AND cover_sticker_id = ?`, pack, int64(id)); err != nil {
					return err
				}
			}
			if t.DeletePack {
				rows, err := tx.QueryContext(ctx, `SELECT blob_id FROM stickers WHERE pack_id = ?`, pack)
				if err != nil {
					return err
				}
				var rest []int64
				for rows.Next() {
					var b int64
					if err := rows.Scan(&b); err != nil {
						rows.Close()
						return err
					}
					rest = append(rest, b)
				}
				rows.Close()
				if err := rows.Err(); err != nil {
					return err
				}
				for _, b := range rest {
					if err := release(b); err != nil {
						return err
					}
				}
				if res, err := tx.ExecContext(ctx, `DELETE FROM sticker_packs WHERE id = ?`, pack); err != nil {
					return err
				} else if n, _ := res.RowsAffected(); n == 0 {
					return ErrNotFound
				}
			} else {
				sets := []string{"updated_at = ?"}
				args := []any{nowMs()}
				if t.Name != nil {
					sets = append(sets, "name = ?")
					args = append(args, *t.Name)
				}
				if t.ClearDescription {
					sets = append(sets, "description = ''")
				}
				if t.Unlist {
					sets = append(sets, "public = 0", "discover_blocked = 1")
				}
				if res, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, pack)...); err != nil {
					return err
				} else if n, _ := res.RowsAffected(); n == 0 {
					return ErrNotFound
				}
			}
		}
		if t.ServerID != nil {
			for _, id := range t.Emojis {
				var blob int64
				if err := tx.QueryRowContext(ctx, `SELECT blob_id FROM emojis WHERE id = ? AND server_id = ?`, int64(id), int64(*t.ServerID)).Scan(&blob); err != nil {
					if errors.Is(err, sql.ErrNoRows) {
						return ErrNotInPack
					}
					return err
				}
				if _, err := tx.ExecContext(ctx, `DELETE FROM emojis WHERE id = ?`, int64(id)); err != nil {
					return err
				}
				if err := release(blob); err != nil {
					return err
				}
			}
		}
		if !t.Block {
			return nil
		}
		// Blocked by content, so every copy goes dark at once: the same
		// picture stored as an avatar or another pack's sticker is the same
		// bytes, and a new upload of it is refused.
		for _, blob := range blobs {
			var sha string
			if err := tx.QueryRowContext(ctx, `SELECT sha256 FROM blobs WHERE id = ?`, blob).Scan(&sha); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					continue
				}
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO blocked_images (sha256, case_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`, sha, int64(c.ID), nowMs()); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET blocked = 1 WHERE sha256 = ?`, sha); err != nil {
				return err
			}
		}
		return nil
	})
}

// ModRelistPack lets a pack the staff took out of Discover be listed again;
// it stays out until its owner lists it.
func (s *Store) ModRelistPack(ctx context.Context, id ids.ID, log *ModLogEntry) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET discover_blocked = 0 WHERE id = ? AND discover_blocked = 1`, int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return appendModLogTx(ctx, tx, log)
	})
}

// ImageBlocked says whether a picture is one the staff took down.
func (s *Store) ImageBlocked(ctx context.Context, sha string) (bool, error) {
	var one int
	err := s.db.R.QueryRowContext(ctx, `SELECT 1 FROM blocked_images WHERE sha256 = ?`, sha).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
