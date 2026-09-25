package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
)

// MFA is a user's second-factor state. Secret is whatever the caller stored:
// the API layer seals it, so the store never sees a usable TOTP seed.
type MFA struct {
	UserID    ids.ID
	Secret    []byte
	LastStep  int64
	Enabled   bool
	CreatedAt int64
}

// MFAFor returns the second-factor row, or nil when the user has none.
func (s *Store) MFAFor(ctx context.Context, id ids.ID) (*MFA, error) {
	var m MFA
	var enabled int64
	err := s.db.R.QueryRowContext(ctx, `SELECT user_id, totp_secret, last_step, enabled, created_at FROM user_mfa WHERE user_id = ?`, int64(id)).
		Scan(&m.UserID, &m.Secret, &m.LastStep, &enabled, &m.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m.Enabled = enabled != 0
	return &m, nil
}

// MFAEnabled reports whether the user must pass a second factor to sign in.
func (s *Store) MFAEnabled(ctx context.Context, id ids.ID) (bool, error) {
	var enabled int64
	err := s.db.R.QueryRowContext(ctx, `SELECT enabled FROM user_mfa WHERE user_id = ?`, int64(id)).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return enabled != 0, nil
}

// EnableTOTP stores the sealed secret and turns the second factor on, replacing
// any earlier one. step is the counter just spent by the confirming code.
func (s *Store) EnableTOTP(ctx context.Context, id ids.ID, sealed []byte, step int64) error {
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO user_mfa (user_id, totp_secret, last_step, enabled, created_at) VALUES (?,?,?,1,?)
		ON CONFLICT(user_id) DO UPDATE SET totp_secret = excluded.totp_secret, last_step = excluded.last_step, enabled = 1, created_at = excluded.created_at`,
		int64(id), sealed, step, nowMs())
	return err
}

// SpendTOTPStep records the counter a login just used, and reports whether it
// was still unused. A replayed code loses the race and is refused.
func (s *Store) SpendTOTPStep(ctx context.Context, id ids.ID, step int64) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE user_mfa SET last_step = ? WHERE user_id = ? AND last_step < ?`, step, int64(id), step)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ErrMFAAlreadyOn says the second factor was already on, so this request is a
// repeat of one that has already finished.
var ErrMFAAlreadyOn = errors.New("mfa already enabled")

// FinishTOTPSetup turns the second factor on and writes its backup codes, as
// one change or none.
//
// Both halves have to land together. Turning it on and then failing to write
// the codes leaves an account locked to an authenticator with nothing to fall
// back on, after a response that said setup failed. Writing the codes first
// and then failing hands out a list that does not work.
//
// It also refuses when the second factor is already on, which is what makes
// the request once-only: the reply to this call is the only copy of the codes
// anyone gets, and a repeat would quietly replace the list just written down.
func (s *Store) FinishTOTPSetup(ctx context.Context, id ids.ID, sealed []byte, step int64, hashes []string) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		// Postgres runs these side by side; one at a time, so two cannot both
		// read the same "before" and act on it
		if err := tx.Serialise(ctx, "mfa", int64(id)); err != nil {
			return err
		}
		var enabled int
		err := tx.QueryRowContext(ctx, `SELECT enabled FROM user_mfa WHERE user_id = ?`, int64(id)).Scan(&enabled)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil && enabled != 0 {
			return ErrMFAAlreadyOn
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_mfa (user_id, totp_secret, last_step, enabled, created_at) VALUES (?,?,?,1,?)
			ON CONFLICT(user_id) DO UPDATE SET totp_secret = excluded.totp_secret, last_step = excluded.last_step, enabled = 1, created_at = excluded.created_at`,
			int64(id), sealed, step, nowMs()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM mfa_backup_codes WHERE user_id = ?`, int64(id)); err != nil {
			return err
		}
		for _, h := range hashes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO mfa_backup_codes (user_id, code_hash, used_at) VALUES (?,?,NULL)`, int64(id), h); err != nil {
				return err
			}
		}
		return nil
	})
}

// DisableMFA removes the second factor and every backup code.
func (s *Store) DisableMFA(ctx context.Context, id ids.ID) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa WHERE user_id = ?`, int64(id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM mfa_backup_codes WHERE user_id = ?`, int64(id))
		return err
	})
}

// ReplaceBackupCodes swaps the whole set of codes for a new one.
func (s *Store) ReplaceBackupCodes(ctx context.Context, id ids.ID, hashes []string) error {
	return s.Tx(ctx, func(tx *db.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM mfa_backup_codes WHERE user_id = ?`, int64(id)); err != nil {
			return err
		}
		for _, h := range hashes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO mfa_backup_codes (user_id, code_hash, used_at) VALUES (?,?,NULL)`, int64(id), h); err != nil {
				return err
			}
		}
		return nil
	})
}

// SpendBackupCode marks one unused code as spent, reporting whether it existed.
func (s *Store) SpendBackupCode(ctx context.Context, id ids.ID, hash string) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE mfa_backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`, nowMs(), int64(id), hash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// CountTwoFactorAccounts counts the accounts with a second factor on, each of
// whose secrets is sealed with the server's own secret.
func (s *Store) CountTwoFactorAccounts(ctx context.Context) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT count(*) FROM user_mfa WHERE enabled = 1`).Scan(&n)
	return n, err
}

// BackupCodesLeft counts the codes still unused.
func (s *Store) BackupCodesLeft(ctx context.Context, id ids.ID) (int, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, `SELECT COUNT(*) FROM mfa_backup_codes WHERE user_id = ? AND used_at IS NULL`, int64(id)).Scan(&n)
	return n, err
}
