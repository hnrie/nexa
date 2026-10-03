package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// ErrTypingImageGone is a typing style naming a picture that is not there
// any more (it was put up over a day ago and never used), or is not one put
// up for a typing style.
var ErrTypingImageGone = errors.New("typing image gone")

// TypingImages is every picture a typing style names: its "img:<id>" slots.
func TypingImages(raw string) map[ids.ID]bool {
	out := map[ids.ID]bool{}
	if raw == "" {
		return out
	}
	var st struct {
		Emoji []string `json:"emoji"`
	}
	if json.Unmarshal([]byte(raw), &st) != nil {
		return out
	}
	for _, e := range st.Emoji {
		if rest, ok := strings.CutPrefix(e, "img:"); ok {
			if id, err := ids.Parse(rest); err == nil {
				out[id] = true
			}
		}
	}
	return out
}

// swapTypingImagesTx moves the references a typing style holds from the
// pictures of the account's style before to the ones of `next`: one more on
// each picture newly named, one fewer on each no longer named.
func swapTypingImagesTx(ctx context.Context, tx *db.Tx, uid ids.ID, next string) error {
	var before string
	if err := tx.QueryRowContext(ctx, `SELECT typing_style FROM users WHERE id = ?`, int64(uid)).Scan(&before); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	old, now := TypingImages(before), TypingImages(next)
	for id := range now {
		if old[id] {
			continue
		}
		res, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ? AND kind = 'typing' AND encrypted = 0`, int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrTypingImageGone
		}
	}
	for id := range old {
		if now[id] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, int64(id)); err != nil {
			return err
		}
	}
	return nil
}
