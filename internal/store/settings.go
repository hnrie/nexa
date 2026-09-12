package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// GetSettings returns the user's settings blob, or nil when none is stored.
func (s *Store) GetSettings(ctx context.Context, userID ids.ID) (*Settings, error) {
	var st Settings
	err := s.db.R.QueryRowContext(ctx, `SELECT blob, version, updated_at FROM user_settings WHERE user_id = ?`, int64(userID)).Scan(&st.Blob, &st.Version, &st.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// PutSettings stores blob when the current version equals ifVersion (0 = no
// row yet). Returns the new version or ErrConflict.
func (s *Store) PutSettings(ctx context.Context, userID ids.ID, blob []byte, ifVersion int64) (int64, error) {
	now := nowMs()
	if ifVersion == 0 {
		res, err := s.db.W.ExecContext(ctx, `INSERT INTO user_settings (user_id, blob, version, updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO NOTHING`, int64(userID), blob, now)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, ErrConflict
		}
		return 1, nil
	}
	res, err := s.db.W.ExecContext(ctx, `UPDATE user_settings SET blob = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?`, blob, now, int64(userID), ifVersion)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrConflict
	}
	return ifVersion + 1, nil
}
