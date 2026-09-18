package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// Emoji is a custom server emoji.
type Emoji struct {
	ID        ids.ID `json:"id"`
	ServerID  ids.ID `json:"server_id"`
	Name      string `json:"name"`
	BlobID    ids.ID `json:"blob_id"`
	Animated  bool   `json:"animated"`
	CreatorID ids.ID `json:"creator_id"`
	CreatedAt int64  `json:"created_at"`
}

// StickerPack is a user- or server-owned collection of stickers.
type StickerPack struct {
	ID ids.ID `json:"id"`
	// Kind is "sticker" or "emoji": an emoji pack holds small images you type
	// as :name:, a sticker pack holds the big ones you post on their own.
	Kind           string     `json:"kind"`
	OwnerUserID    *ids.ID    `json:"owner_user_id"`
	ServerID       *ids.ID    `json:"server_id"`
	Name           string     `json:"name"`
	Description    string     `json:"description"`
	CoverStickerID *ids.ID    `json:"cover_sticker_id"`
	Public         bool       `json:"public"`
	CreatedAt      int64      `json:"created_at"`
	UpdatedAt      int64      `json:"updated_at"`
	Stickers       []*Sticker `json:"stickers"`
	// Installed is set for listings from the viewer's perspective.
	Installed bool `json:"installed"`
}

// Sticker is one image in a pack.
type Sticker struct {
	ID        ids.ID `json:"id"`
	PackID    ids.ID `json:"pack_id"`
	Name      string `json:"name"`
	Tags      string `json:"tags"`
	BlobID    ids.ID `json:"blob_id"`
	Format    string `json:"format"`
	Position  int    `json:"position"`
	CreatorID ids.ID `json:"creator_id"`
	CreatedAt int64  `json:"created_at"`
	Width     *int   `json:"width,omitempty"`
	Height    *int   `json:"height,omitempty"`
	Animated  bool   `json:"animated"`
}

// StickerPackPatch is an optional set of pack changes.
type StickerPackPatch struct {
	Name           *string
	Description    *string
	Public         *bool
	CoverStickerID **ids.ID
}

const emojiCols = `id, server_id, name, blob_id, animated, creator_id, created_at`

func scanEmoji(r rowScanner) (*Emoji, error) {
	var e Emoji
	var animated int64
	if err := r.Scan(&e.ID, &e.ServerID, &e.Name, &e.BlobID, &animated, &e.CreatorID, &e.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	e.Animated = animated == 1
	return &e, nil
}

// CreateEmoji adds a custom emoji; names are unique per server.
func (s *Store) CreateEmoji(ctx context.Context, e *Emoji) error {
	e.ID = ids.New()
	e.CreatedAt = nowMs()
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO emojis (`+emojiCols+`) VALUES (?,?,?,?,?,?,?)`, int64(e.ID), int64(e.ServerID), e.Name, int64(e.BlobID), boolInt(e.Animated), int64(e.CreatorID), e.CreatedAt)
	if err != nil && db.IsUniqueViolation(err) {
		return ErrAlreadyExists
	}
	return err
}

// EmojiByID loads one emoji.
func (s *Store) EmojiByID(ctx context.Context, id ids.ID) (*Emoji, error) {
	return scanEmoji(s.db.R.QueryRowContext(ctx, `SELECT `+emojiCols+` FROM emojis WHERE id = ?`, int64(id)))
}

// ServerEmojis lists a server's emoji by name.
func (s *Store) ServerEmojis(ctx context.Context, serverID ids.ID) ([]*Emoji, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+emojiCols+` FROM emojis WHERE server_id = ? ORDER BY name`, int64(serverID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Emoji{}
	for rows.Next() {
		e, err := scanEmoji(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// EmojisForUser lists the emoji of every server the user is in.
func (s *Store) EmojisForUser(ctx context.Context, uid ids.ID) ([]*Emoji, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+prefixed("e", emojiCols)+` FROM emojis e JOIN server_members m ON m.server_id = e.server_id WHERE m.user_id = ? ORDER BY e.server_id, e.name`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Emoji{}
	for rows.Next() {
		e, err := scanEmoji(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RenameEmoji changes an emoji's name.
func (s *Store) RenameEmoji(ctx context.Context, id ids.ID, name string) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE emojis SET name = ? WHERE id = ?`, name, int64(id))
	if err != nil {
		if db.IsUniqueViolation(err) {
			return ErrAlreadyExists
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteEmoji removes an emoji and drops its blob reference.
func (s *Store) DeleteEmoji(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var blob int64
		if err := tx.QueryRowContext(ctx, `SELECT blob_id FROM emojis WHERE id = ?`, int64(id)).Scan(&blob); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM emojis WHERE id = ?`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(s.db.Dialect, "ref_count - 1")+` WHERE id = ?`, blob)
		return err
	})
}

// --- sticker packs -------------------------------------------------------

const packCols = `id, kind, owner_user_id, server_id, name, description, cover_sticker_id, public, created_at, updated_at`

func scanPack(r rowScanner) (*StickerPack, error) {
	var p StickerPack
	var owner, server, cover sql.NullInt64
	var public int64
	if err := r.Scan(&p.ID, &p.Kind, &owner, &server, &p.Name, &p.Description, &cover, &public, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.OwnerUserID, p.ServerID, p.CoverStickerID = idPtr(owner), idPtr(server), idPtr(cover)
	p.Public = public == 1
	p.Stickers = []*Sticker{}
	return &p, nil
}

// CreatePack creates a pack owned by a user or a server.
func (s *Store) CreatePack(ctx context.Context, p *StickerPack) error {
	p.ID = ids.New()
	p.CreatedAt = nowMs()
	p.UpdatedAt = p.CreatedAt
	p.Stickers = []*Sticker{}
	if p.Kind != "emoji" {
		p.Kind = "sticker"
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO sticker_packs (`+packCols+`) VALUES (?,?,?,?,?,?,?,?,?,?)`, int64(p.ID), p.Kind, nullID(p.OwnerUserID), nullID(p.ServerID), p.Name, p.Description, nullID(p.CoverStickerID), boolInt(p.Public), p.CreatedAt, p.UpdatedAt)
	return err
}

// PackByID loads a pack with its stickers.
func (s *Store) PackByID(ctx context.Context, id ids.ID) (*StickerPack, error) {
	p, err := scanPack(s.db.R.QueryRowContext(ctx, `SELECT `+packCols+` FROM sticker_packs WHERE id = ?`, int64(id)))
	if err != nil {
		return nil, err
	}
	if p.Stickers, err = s.PackStickers(ctx, p.ID); err != nil {
		return nil, err
	}
	return p, nil
}

// UpdatePack applies a patch and bumps updated_at.
func (s *Store) UpdatePack(ctx context.Context, id ids.ID, patch StickerPackPatch) error {
	sets := []string{"updated_at = ?"}
	args := []any{nowMs()}
	if patch.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *patch.Name)
	}
	if patch.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *patch.Description)
	}
	if patch.Public != nil {
		sets = append(sets, "public = ?")
		args = append(args, boolInt(*patch.Public))
	}
	if patch.CoverStickerID != nil {
		sets = append(sets, "cover_sticker_id = ?")
		args = append(args, nullID(*patch.CoverStickerID))
	}
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE sticker_packs SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePack removes a pack, its stickers and their blob references.
func (s *Store) DeletePack(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		// one reference per sticker: the same picture added twice holds two
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - (SELECT count(*) FROM stickers st WHERE st.pack_id = ? AND st.blob_id = blobs.id)")+` WHERE id IN (SELECT blob_id FROM stickers WHERE pack_id = ?)`, int64(id), int64(id)); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM sticker_packs WHERE id = ?`, int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func (s *Store) packsQuery(ctx context.Context, where string, args ...any) ([]*StickerPack, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+prefixed("p", packCols)+` FROM sticker_packs p `+where, args...)
	if err != nil {
		return nil, err
	}
	out := []*StickerPack{}
	for rows.Next() {
		p, err := scanPack(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, p := range out {
		if p.Stickers, err = s.PackStickers(ctx, p.ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// PacksForUser lists the packs a user owns, installed, or shares a server with.
func (s *Store) PacksForUser(ctx context.Context, uid ids.ID) ([]*StickerPack, error) {
	packs, err := s.packsQuery(ctx, `WHERE p.owner_user_id = ? OR p.id IN (SELECT pack_id FROM sticker_installs WHERE user_id = ?) OR p.server_id IN (SELECT server_id FROM server_members WHERE user_id = ?) ORDER BY p.updated_at DESC`, int64(uid), int64(uid), int64(uid))
	if err != nil {
		return nil, err
	}
	installed, err := s.installedSet(ctx, uid)
	if err != nil {
		return nil, err
	}
	for _, p := range packs {
		p.Installed = installed[p.ID]
	}
	return packs, nil
}

// PublicPacks searches public packs by name or description.
func (s *Store) PublicPacks(ctx context.Context, uid ids.ID, q string, limit int) ([]*StickerPack, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var packs []*StickerPack
	var err error
	if q = strings.TrimSpace(q); q == "" {
		packs, err = s.packsQuery(ctx, `WHERE p.public = 1 ORDER BY p.updated_at DESC LIMIT ?`, limit)
	} else {
		if len(q) > maxSearchQuery {
			q = q[:maxSearchQuery]
		}
		// as SearchUsers does: the wildcards in the query are escaped, and the
		// folding is the dialect's so it works past ASCII on SQLite too
		like := "%" + escapeLike(strings.ToLower(q)) + "%"
		lower := s.db.Dialect.Lower
		packs, err = s.packsQuery(ctx, `WHERE p.public = 1 AND (`+lower("p.name")+` LIKE ? ESCAPE '\' OR `+lower("p.description")+` LIKE ? ESCAPE '\') ORDER BY p.updated_at DESC LIMIT ?`, like, like, limit)
	}
	if err != nil {
		return nil, err
	}
	installed, err := s.installedSet(ctx, uid)
	if err != nil {
		return nil, err
	}
	for _, p := range packs {
		p.Installed = installed[p.ID]
	}
	return packs, nil
}

func (s *Store) installedSet(ctx context.Context, uid ids.ID) (map[ids.ID]bool, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT pack_id FROM sticker_installs WHERE user_id = ?`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ids.ID]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[ids.ID(id)] = true
	}
	return out, rows.Err()
}

// InstallPack adds a public pack to the user's collection.
func (s *Store) InstallPack(ctx context.Context, uid, packID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO sticker_installs (user_id, pack_id, installed_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`, int64(uid), int64(packID), nowMs())
	return err
}

// UninstallPack removes a pack from the user's collection.
func (s *Store) UninstallPack(ctx context.Context, uid, packID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM sticker_installs WHERE user_id = ? AND pack_id = ?`, int64(uid), int64(packID))
	return err
}

// Installers lists users who installed a pack (for change notifications).
// Installed reports whether one person has one pack installed.
//
// Answering that from Installers meant reading every install row of the pack —
// and the packs this is asked about are by definition the popular public ones,
// so the most-installed pack cost the most rows to answer a boolean about.
func (s *Store) Installed(ctx context.Context, uid, packID ids.ID) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM sticker_installs WHERE user_id = ? AND pack_id = ?`, int64(uid), int64(packID)).Scan(&n)
	return n > 0, err
}

func (s *Store) Installers(ctx context.Context, packID ids.ID) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT user_id FROM sticker_installs WHERE pack_id = ?`, int64(packID))
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

// --- stickers ------------------------------------------------------------

const stickerCols = `s.id, s.pack_id, s.name, s.tags, s.blob_id, s.format, s.position, s.creator_id, s.created_at, b.width, b.height, b.animated`

func scanSticker(r rowScanner) (*Sticker, error) {
	var st Sticker
	var w, h sql.NullInt64
	var animated int64
	if err := r.Scan(&st.ID, &st.PackID, &st.Name, &st.Tags, &st.BlobID, &st.Format, &st.Position, &st.CreatorID, &st.CreatedAt, &w, &h, &animated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if w.Valid {
		v := int(w.Int64)
		st.Width = &v
	}
	if h.Valid {
		v := int(h.Int64)
		st.Height = &v
	}
	st.Animated = animated == 1
	return &st, nil
}

// AddSticker appends a sticker to a pack.
func (s *Store) AddSticker(ctx context.Context, st *Sticker) error {
	st.ID = ids.New()
	st.CreatedAt = nowMs()
	return s.Tx(ctx, func(tx *db.Tx) error {
		var max sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT max(position) FROM stickers WHERE pack_id = ?`, int64(st.PackID)).Scan(&max); err != nil {
			return err
		}
		st.Position = 0
		if max.Valid {
			st.Position = int(max.Int64) + 1
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO stickers (id, pack_id, name, tags, blob_id, format, position, creator_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`, int64(st.ID), int64(st.PackID), st.Name, st.Tags, int64(st.BlobID), st.Format, st.Position, int64(st.CreatorID), st.CreatedAt); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET updated_at = ? WHERE id = ?`, st.CreatedAt, int64(st.PackID))
		return err
	})
}

// StickerByID loads one sticker.
func (s *Store) StickerByID(ctx context.Context, id ids.ID) (*Sticker, error) {
	return scanSticker(s.db.R.QueryRowContext(ctx, `SELECT `+stickerCols+` FROM stickers s JOIN blobs b ON b.id = s.blob_id WHERE s.id = ?`, int64(id)))
}

// PackStickers lists a pack's stickers in order.
func (s *Store) PackStickers(ctx context.Context, packID ids.ID) ([]*Sticker, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+stickerCols+` FROM stickers s JOIN blobs b ON b.id = s.blob_id WHERE s.pack_id = ? ORDER BY s.position, s.id`, int64(packID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Sticker{}
	for rows.Next() {
		st, err := scanSticker(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// UpdateSticker renames or retags a sticker.
func (s *Store) UpdateSticker(ctx context.Context, id ids.ID, name, tags *string) error {
	sets := []string{}
	args := []any{}
	if name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *name)
	}
	if tags != nil {
		sets = append(sets, "tags = ?")
		args = append(args, *tags)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE stickers SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSticker removes a sticker and drops its blob reference.
func (s *Store) DeleteSticker(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var blob, pack int64
		if err := tx.QueryRowContext(ctx, `SELECT blob_id, pack_id FROM stickers WHERE id = ?`, int64(id)).Scan(&blob, &pack); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM stickers WHERE id = ?`, int64(id)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(s.db.Dialect, "ref_count - 1")+` WHERE id = ?`, blob); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET cover_sticker_id = NULL WHERE id = ? AND cover_sticker_id = ?`, pack, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET updated_at = ? WHERE id = ?`, nowMs(), pack)
		return err
	})
}

// SetStickerPositions rewrites the order of a pack's stickers.
func (s *Store) SetStickerPositions(ctx context.Context, packID ids.ID, positions map[ids.ID]int) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		for id, pos := range positions {
			if _, err := tx.ExecContext(ctx, `UPDATE stickers SET position = ? WHERE id = ? AND pack_id = ?`, pos, int64(id), int64(packID)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE sticker_packs SET updated_at = ? WHERE id = ?`, nowMs(), int64(packID))
		return err
	})
}
