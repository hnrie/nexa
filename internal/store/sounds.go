package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// Sound packs: the recordings someone picked to play for a new message, a
// call and the rest. What a pack is and which sound plays when lives in the
// account's encrypted settings; the server only keeps the sealed files, each
// held by a row here so nothing sweeps it away.

const (
	// MaxUserSounds is how many sound files one account keeps, across all of
	// its packs: a handful of packs with every sound replaced.
	MaxUserSounds = 64
	// MaxSoundBytes is the most one sealed sound file may weigh. The app
	// turns whatever it is given into a short mono recording first, which
	// is well under this even for a ringtone.
	MaxSoundBytes = 3 << 20
)

// UserSound is one sound file an account keeps.
type UserSound struct {
	BlobID    ids.ID `json:"blob_id"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"created_at"`
}

// UserSounds lists the sound files an account keeps, oldest first.
func (s *Store) UserSounds(ctx context.Context, uid ids.ID) ([]UserSound, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT us.blob_id, b.size, us.created_at FROM user_sounds us JOIN blobs b ON b.id = us.blob_id WHERE us.user_id = ? ORDER BY us.created_at, us.blob_id`, int64(uid))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserSound{}
	for rows.Next() {
		var u UserSound
		if err := rows.Scan(&u.BlobID, &u.Size, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// AddUserSound keeps a file as one of the account's sounds. Only a sealed
// file the account uploaded itself can be kept, and no more than
// MaxUserSounds. Keeping one twice is not an error.
func (s *Store) AddUserSound(ctx context.Context, uid, blobID ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		// one account's sounds one at a time, so two uploads cannot both squeeze under the limit
		if err := tx.Serialise(ctx, "user_sounds", int64(uid)); err != nil {
			return err
		}
		var owner sql.NullInt64
		var kind string
		var encrypted int
		err := tx.QueryRowContext(ctx, `SELECT owner_id, kind, encrypted FROM blobs WHERE id = ?`, int64(blobID)).Scan(&owner, &kind, &encrypted)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && (kind != "attachment" || encrypted != 1 || !owner.Valid || owner.Int64 != int64(uid))) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var have, count int
		if err := tx.QueryRowContext(ctx, `SELECT
			(SELECT count(*) FROM user_sounds WHERE user_id = ? AND blob_id = ?),
			(SELECT count(*) FROM user_sounds WHERE user_id = ?)`, int64(uid), int64(blobID), int64(uid)).Scan(&have, &count); err != nil {
			return err
		}
		if have > 0 {
			return nil
		}
		if count >= MaxUserSounds {
			return ErrTooMany
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_sounds (user_id, blob_id, created_at) VALUES (?,?,?)`, int64(uid), int64(blobID), nowMs()); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?`, int64(blobID))
		return err
	})
}

// RemoveUserSound lets one of the account's sound files go. Removing one the
// account does not keep is ErrNotFound.
func (s *Store) RemoveUserSound(ctx context.Context, uid, blobID ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM user_sounds WHERE user_id = ? AND blob_id = ?`, int64(uid), int64(blobID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.ExecContext(ctx, `UPDATE blobs SET ref_count = `+refFloor(tx.Dialect(), "ref_count - 1")+` WHERE id = ?`, int64(blobID))
		return err
	})
}

// deleteUserSoundsTx lets every sound file of an account go, for its deletion.
func deleteUserSoundsTx(ctx context.Context, tx *db.Tx, uid int64) error {
	if err := releaseBlobRefs(ctx, tx, `SELECT blob_id FROM user_sounds WHERE user_id = ?`, uid); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM user_sounds WHERE user_id = ?`, uid)
	return err
}
