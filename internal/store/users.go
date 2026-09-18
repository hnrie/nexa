package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"

	"modernc.org/sqlite"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// SQLite's lower() and LIKE only fold ASCII, so a search for "łukasz" would
// never find "Łukasz". ulower folds a column the same way Go folds the query.
func init() {
	sqlite.MustRegisterDeterministicScalarFunction("ulower", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		switch v := args[0].(type) {
		case string:
			return strings.ToLower(v), nil
		case []byte:
			return strings.ToLower(string(v)), nil
		}
		return args[0], nil
	})
}

const userCols = `id, username, display_name, auth_hash, kdf_salt, kdf_params, public_key, enc_private_key, enc_private_key_recovery, recovery_auth_hash, avatar_id, banner_id, about_me, pronouns, accent_color, accent_color_2, status_text, status_emoji, status_expires_at, presence_pref, dm_privacy, flags, created_at, updated_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanUser(r rowScanner) (*User, error) {
	var u User
	var recoveryHash sql.NullString
	var avatar, banner, accent, accent2, statusExp sql.NullInt64
	err := r.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AuthHash, &u.KDFSalt, &u.KDFParams, &u.PublicKey, &u.EncPrivateKey, &u.EncPrivateKeyRecovery, &recoveryHash,
		&avatar, &banner, &u.AboutMe, &u.Pronouns, &accent, &accent2, &u.StatusText, &u.StatusEmoji, &statusExp, &u.PresencePref, &u.DMPrivacy, &u.Flags, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.RecoveryAuthHash = recoveryHash.String
	u.AvatarID, u.BannerID = idPtr(avatar), idPtr(banner)
	u.AccentColor, u.AccentColor2 = intPtr(accent), intPtr(accent2)
	u.StatusExpiresAt = int64Ptr(statusExp)
	return &u, nil
}

// CreateUser inserts u (ID and CreatedAt are filled in when zero).
func (s *Store) CreateUser(ctx context.Context, u *User) error {
	if u.ID.IsZero() {
		u.ID = ids.New()
	}
	if u.CreatedAt == 0 {
		u.CreatedAt = nowMs()
	}
	u.UpdatedAt = u.CreatedAt
	if u.PresencePref == "" {
		u.PresencePref = "online"
	}
	if u.DMPrivacy == "" {
		u.DMPrivacy = "everyone"
	}
	var recovery any
	if u.RecoveryAuthHash != "" {
		recovery = u.RecoveryAuthHash
	}
	res, err := s.db.W.ExecContext(ctx, `INSERT INTO users (`+userCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING`,
		int64(u.ID), u.Username, u.DisplayName, u.AuthHash, u.KDFSalt, u.KDFParams, u.PublicKey, u.EncPrivateKey, u.EncPrivateKeyRecovery, recovery,
		nullID(u.AvatarID), nullID(u.BannerID), u.AboutMe, u.Pronouns, nullInt(u.AccentColor), nullInt(u.AccentColor2), u.StatusText, u.StatusEmoji, nullInt64(u.StatusExpiresAt), u.PresencePref, u.DMPrivacy, u.Flags, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrUsernameTaken
	}
	return nil
}

// UserByID loads one user.
func (s *Store) UserByID(ctx context.Context, id ids.ID) (*User, error) {
	return scanUser(s.db.R.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id = ?`, int64(id)))
}

// UserByUsername loads one user by exact (lowercase) username.
func (s *Store) UserByUsername(ctx context.Context, username string) (*User, error) {
	return scanUser(s.db.R.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE username = ?`, username))
}

// UsersByIDs loads many users at once.
func (s *Store) UsersByIDs(ctx context.Context, list []ids.ID) (map[ids.ID]*User, error) {
	out := map[ids.ID]*User{}
	for start := 0; start < len(list); start += 500 {
		end := start + 500
		if end > len(list) {
			end = len(list)
		}
		chunk := list[start:end]
		rows, err := s.db.R.QueryContext(ctx, `SELECT `+userCols+` FROM users WHERE id IN (`+placeholders(len(chunk))+`)`, idArgs(chunk)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			u, err := scanUser(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out[u.ID] = u
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// SearchUsers finds users whose username or display name starts with q.
func (s *Store) SearchUsers(ctx context.Context, q string, limit int) ([]*User, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	like := escapeLike(q) + "%"
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+userCols+` FROM users WHERE (username LIKE ? ESCAPE '\' OR `+s.db.Dialect.Lower("display_name")+` LIKE ? ESCAPE '\') AND flags & ? = 0 ORDER BY username LIMIT ?`, like, like, FlagDeleted, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// maxSearchQuery bounds how much text a search pattern is built from, so a
// very long one cannot become a very expensive LIKE.
const maxSearchQuery = 100

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// CountUsers returns the number of accounts.
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// UpdateProfile applies p to the user.
func (s *Store) UpdateProfile(ctx context.Context, id ids.ID, p ProfilePatch) error {
	var sets []string
	var args []any
	set := func(col string, v any) { sets = append(sets, col+" = ?"); args = append(args, v) }
	if p.Username != nil {
		set("username", *p.Username)
	}
	if p.DisplayName != nil {
		set("display_name", *p.DisplayName)
	}
	if p.AboutMe != nil {
		set("about_me", *p.AboutMe)
	}
	if p.Pronouns != nil {
		set("pronouns", *p.Pronouns)
	}
	if p.AccentColor != nil {
		set("accent_color", nullInt(*p.AccentColor))
	}
	if p.AccentColor2 != nil {
		set("accent_color_2", nullInt(*p.AccentColor2))
	}
	if p.AvatarID != nil {
		set("avatar_id", nullID(*p.AvatarID))
	}
	if p.BannerID != nil {
		set("banner_id", nullID(*p.BannerID))
	}
	if p.StatusText != nil {
		set("status_text", *p.StatusText)
	}
	if p.StatusEmoji != nil {
		set("status_emoji", *p.StatusEmoji)
	}
	if p.StatusExpiresAt != nil {
		set("status_expires_at", nullInt64(*p.StatusExpiresAt))
	}
	if p.PresencePref != nil {
		set("presence_pref", *p.PresencePref)
	}
	if p.DMPrivacy != nil {
		set("dm_privacy", *p.DMPrivacy)
	}
	if len(sets) == 0 {
		return nil
	}
	set("updated_at", nowMs())
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		if p.Username != nil && db.IsUniqueViolation(err) {
			return ErrUsernameTaken
		}
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AuthUpdate carries replacement credentials. AuthHash and EncPrivateKey are
// required; KDFSalt/KDFParams replace the stretch parameters when set; the
// recovery pair is replaced when RecoveryAuthHash is non-empty.
type AuthUpdate struct {
	AuthHash              string
	KDFSalt               []byte
	KDFParams             string
	EncPrivateKey         []byte
	RecoveryAuthHash      string
	EncPrivateKeyRecovery []byte
}

// UpdateAuth replaces the password-derived credentials.
func (s *Store) UpdateAuth(ctx context.Context, id ids.ID, a AuthUpdate) error {
	sets := []string{"auth_hash = ?", "enc_private_key = ?", "updated_at = ?"}
	args := []any{a.AuthHash, a.EncPrivateKey, nowMs()}
	if len(a.KDFSalt) > 0 && a.KDFParams != "" {
		sets = append(sets, "kdf_salt = ?", "kdf_params = ?")
		args = append(args, a.KDFSalt, a.KDFParams)
	}
	if a.RecoveryAuthHash != "" {
		sets = append(sets, "recovery_auth_hash = ?", "enc_private_key_recovery = ?")
		args = append(args, a.RecoveryAuthHash, a.EncPrivateKeyRecovery)
	}
	args = append(args, int64(id))
	res, err := s.db.W.ExecContext(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateRecovery replaces only the recovery pair.
func (s *Store) UpdateRecovery(ctx context.Context, id ids.ID, recoveryHash string, encPrivRecovery []byte) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE users SET recovery_auth_hash = ?, enc_private_key_recovery = ?, updated_at = ? WHERE id = ?`, recoveryHash, encPrivRecovery, nowMs(), int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUserFlags overwrites the flags bitfield.
func (s *Store) SetUserFlags(ctx context.Context, id ids.ID, flags int64) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE users SET flags = ?, updated_at = ? WHERE id = ?`, flags, nowMs(), int64(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ChangeUserFlags turns the set bits on and the clear bits off, leaving every
// other bit as it was, and returns the whole field afterwards.
//
// Two admins acting on the same account at the same moment used to read the
// same flags, each compute a new whole value in Go, and each write it: whoever
// landed second silently undid the other's change, and both were shown the
// change they made. Doing it in one statement means neither can lose the
// other's bit, and the value that comes back is what is stored.
func (s *Store) ChangeUserFlags(ctx context.Context, id ids.ID, set, clear int64) (int64, error) {
	var flags int64
	err := s.Tx(ctx, func(tx *db.Tx) error {
		// The complement is worked out here rather than with a ~ in the SQL:
		// Postgres reads ~ on an untyped parameter as the regular-expression
		// operator and refuses the statement as ambiguous.
		res, err := tx.ExecContext(ctx, `UPDATE users SET flags = (flags | ?) & ?, updated_at = ? WHERE id = ?`, set, ^clear, nowMs(), int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return tx.QueryRowContext(ctx, `SELECT flags FROM users WHERE id = ?`, int64(id)).Scan(&flags)
	})
	if err != nil {
		return 0, err
	}
	return flags, nil
}

// DeleteAccount anonymises the account (messages are kept) and drops sessions.
func (s *Store) DeleteAccount(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		anon := fmt.Sprintf("deleted-%d", int64(id))
		// the avatar and banner are cleared below; give back their references
		if err := releaseBlobRefs(ctx, tx, `SELECT avatar_id FROM users WHERE id = ? UNION ALL SELECT banner_id FROM users WHERE id = ?`, int64(id), int64(id)); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `UPDATE users SET username = ?, display_name = 'Deleted User', auth_hash = '!', enc_private_key = ?, enc_private_key_recovery = NULL, recovery_auth_hash = NULL, avatar_id = NULL, banner_id = NULL, about_me = '', pronouns = '', status_text = '', status_emoji = '', flags = flags | ?, updated_at = ? WHERE id = ?`, anon, []byte{}, FlagDeleted, nowMs(), int64(id))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		for _, q := range []string{`DELETE FROM sessions WHERE user_id = ?`, `DELETE FROM relationships WHERE user_id = ? OR target_id = ?`, `DELETE FROM user_settings WHERE user_id = ?`, `DELETE FROM key_grants WHERE user_id = ?`, `DELETE FROM user_mfa WHERE user_id = ?`, `DELETE FROM mfa_backup_codes WHERE user_id = ?`} {
			args := []any{int64(id)}
			if strings.Count(q, "?") == 2 {
				args = append(args, int64(id))
			}
			if _, err := tx.ExecContext(ctx, q, args...); err != nil {
				return err
			}
		}
		return nil
	})
}
