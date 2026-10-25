package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// MaxPasskeys is how many passkeys one account may keep.
const MaxPasskeys = 20

// Passkey is a WebAuthn credential that signs its account in. EncPrivateKey is
// the identity key as the app wrapped it with the passkey's PRF output; the
// server only hands it back.
type Passkey struct {
	ID            ids.ID `json:"id"`
	UserID        ids.ID `json:"-"`
	CredentialID  []byte `json:"-"`
	PublicKey     []byte `json:"-"`
	Alg           int64  `json:"-"`
	SignCount     int64  `json:"-"`
	RPID          string `json:"rp_id"`
	Name          string `json:"name"`
	EncPrivateKey []byte `json:"-"`
	CreatedAt     int64  `json:"created_at"`
	LastUsedAt    int64  `json:"last_used_at"`
}

const passkeyCols = `id, user_id, credential_id, public_key, alg, sign_count, rp_id, name, enc_private_key, created_at, last_used_at`

func scanPasskey(r rowScanner) (*Passkey, error) {
	var p Passkey
	if err := r.Scan(&p.ID, &p.UserID, &p.CredentialID, &p.PublicKey, &p.Alg, &p.SignCount, &p.RPID, &p.Name, &p.EncPrivateKey, &p.CreatedAt, &p.LastUsedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// CreatePasskey stores a new passkey, refusing one past MaxPasskeys and a
// credential id already stored (ErrConflict).
func (s *Store) CreatePasskey(ctx context.Context, p *Passkey) error {
	p.ID = ids.New()
	p.CreatedAt = nowMs()
	return s.db.Tx(ctx, func(tx *db.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM passkeys WHERE user_id = ?`, int64(p.UserID)).Scan(&n); err != nil {
			return err
		}
		if n >= MaxPasskeys {
			return ErrLimit
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO passkeys (`+passkeyCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			int64(p.ID), int64(p.UserID), p.CredentialID, p.PublicKey, p.Alg, p.SignCount, p.RPID, p.Name, p.EncPrivateKey, p.CreatedAt, p.LastUsedAt)
		if db.IsUniqueViolation(err) {
			return ErrConflict
		}
		return err
	})
}

// PasskeyByCredential finds the passkey a sign-in names.
func (s *Store) PasskeyByCredential(ctx context.Context, credID []byte) (*Passkey, error) {
	return scanPasskey(s.db.R.QueryRowContext(ctx, `SELECT `+passkeyCols+` FROM passkeys WHERE credential_id = ?`, credID))
}

// PasskeysByUser lists an account's passkeys, oldest first.
func (s *Store) PasskeysByUser(ctx context.Context, userID ids.ID) ([]*Passkey, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+passkeyCols+` FROM passkeys WHERE user_id = ? ORDER BY id`, int64(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Passkey{}
	for rows.Next() {
		p, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UsePasskey records a sign-in. The counter only moves forward, so an
// assertion replayed from before cannot be spent again (count 0 means the
// authenticator keeps none, as synced passkeys do).
func (s *Store) UsePasskey(ctx context.Context, id ids.ID, prevCount, count int64) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ? AND sign_count = ?`, count, nowMs(), int64(id), prevCount)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// RenamePasskey changes the name its owner gave it.
func (s *Store) RenamePasskey(ctx context.Context, userID, id ids.ID, name string) error {
	res, err := s.db.W.ExecContext(ctx, `UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?`, name, int64(id), int64(userID))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePasskey removes one of the account's passkeys.
func (s *Store) DeletePasskey(ctx context.Context, userID, id ids.ID) error {
	res, err := s.db.W.ExecContext(ctx, `DELETE FROM passkeys WHERE id = ? AND user_id = ?`, int64(id), int64(userID))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
