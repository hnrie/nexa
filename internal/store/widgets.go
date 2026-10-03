package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// UserWidgets is the JSON of someone's profile widgets, or "" for none.
func (s *Store) UserWidgets(ctx context.Context, uid ids.ID) (string, error) {
	var raw string
	err := s.db.R.QueryRowContext(ctx, `SELECT widgets FROM users WHERE id = ?`, int64(uid)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return raw, err
}

// SetUserWidgets replaces someone's widgets, taking a reference on each
// picture the new ones name that the old ones did not, and giving back the
// ones the old ones named that the new ones do not, in one transaction. A
// picture that is gone, or is not a widget's, fails it.
func (s *Store) SetUserWidgets(ctx context.Context, uid ids.ID, raw string) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		var old string
		if err := tx.QueryRowContext(ctx, `SELECT widgets FROM users WHERE id = ?`, int64(uid)).Scan(&old); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		before, after := WidgetImages(old), WidgetImages(raw)
		for id := range after {
			if before[id] {
				continue
			}
			res, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ? AND kind = 'widget' AND encrypted = 0`, int64(id))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return ErrNotFound
			}
		}
		for id := range before {
			if after[id] {
				continue
			}
			if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, int64(id)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE users SET widgets = ?, updated_at = ? WHERE id = ?`, raw, nowMs(), int64(uid))
		return err
	})
}

// WidgetImages is every picture widgets' JSON names: an "image" on a widget
// or on one of its games, as the server writes them.
func WidgetImages(raw string) map[ids.ID]bool {
	out := map[ids.ID]bool{}
	if raw == "" {
		return out
	}
	var list []struct {
		Image string `json:"image"`
		Games []struct {
			Image string `json:"image"`
		} `json:"games"`
	}
	if json.Unmarshal([]byte(raw), &list) != nil {
		return out
	}
	add := func(v string) {
		if id, err := ids.Parse(v); err == nil && v != "" {
			out[id] = true
		}
	}
	for _, w := range list {
		add(w.Image)
		for _, g := range w.Games {
			add(g.Image)
		}
	}
	return out
}
