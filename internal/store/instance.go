package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"evilion.xyz/chat/internal/ids"
)

// InstanceSetting reads one runtime setting ("" when unset).
func (s *Store) InstanceSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.R.QueryRowContext(ctx, `SELECT value FROM instance_settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetInstanceSetting writes (or clears, when value is empty) a runtime setting.
func (s *Store) SetInstanceSetting(ctx context.Context, key, value string) error {
	if value == "" {
		_, err := s.db.W.ExecContext(ctx, `DELETE FROM instance_settings WHERE key = ?`, key)
		return err
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// InstanceSettings returns every runtime setting.
func (s *Store) InstanceSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT key, value FROM instance_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// InstanceStats is what the admin page shows.
type InstanceStats struct {
	Users     int   `json:"users"`
	Servers   int   `json:"servers"`
	Messages  int   `json:"messages"`
	Blobs     int   `json:"blobs"`
	BlobBytes int64 `json:"blob_bytes"`
}

// Stats counts the big tables.
func (s *Store) Stats(ctx context.Context) (*InstanceStats, error) {
	st := &InstanceStats{}
	row := s.db.R.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM servers), (SELECT count(*) FROM messages), (SELECT count(*) FROM blobs), (SELECT coalesce(sum(size), 0) FROM blobs)`)
	if err := row.Scan(&st.Users, &st.Servers, &st.Messages, &st.Blobs, &st.BlobBytes); err != nil {
		return nil, err
	}
	return st, nil
}

// AdminUser is a user row as the admin page sees it.
type AdminUser struct {
	ID          ids.ID `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Flags       int64  `json:"flags"`
	CreatedAt   int64  `json:"created_at"`
	Admin       bool   `json:"admin"`
	Disabled    bool   `json:"disabled"`
}

// AdminUsers pages users (newest first) with an optional username search.
func (s *Store) AdminUsers(ctx context.Context, q string, before ids.ID, limit int) ([]*AdminUser, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where := `WHERE flags & ? = 0`
	args := []any{FlagDeleted}
	if strings.TrimSpace(q) != "" {
		where += ` AND (username LIKE ? OR lower(display_name) LIKE ?)`
		like := "%" + strings.ToLower(strings.TrimSpace(q)) + "%"
		args = append(args, like, like)
	}
	if !before.IsZero() {
		where += ` AND id < ?`
		args = append(args, int64(before))
	}
	args = append(args, limit)
	rows, err := s.db.R.QueryContext(ctx, `SELECT id, username, display_name, flags, created_at FROM users `+where+` ORDER BY id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AdminUser{}
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Flags, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Admin = u.Flags&FlagAdmin != 0
		u.Disabled = u.Flags&FlagDisabled != 0
		out = append(out, &u)
	}
	return out, rows.Err()
}

// SetRelationshipNickname stores a private nickname for a friend.
func (s *Store) SetRelationshipNickname(ctx context.Context, uid, other ids.ID, nickname string) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE relationships SET nickname = ? WHERE user_id = ? AND target_id = ? AND type = 'friend'`, nickname, int64(uid), int64(other))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
