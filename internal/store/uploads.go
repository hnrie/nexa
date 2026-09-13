package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

// Upload is a transfer in progress: a file arriving in pieces.
type Upload struct {
	ID        ids.ID `json:"id"`
	UserID    ids.ID `json:"user_id"`
	Size      int64  `json:"size"`
	Received  int64  `json:"received"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	// BlobID is what the transfer became once it was finished.
	BlobID *ids.ID `json:"-"`
}

// CreateUpload opens a transfer.
func (s *Store) CreateUpload(ctx context.Context, userID ids.ID, size int64) (*Upload, error) {
	u := &Upload{ID: ids.New(), UserID: userID, Size: size, CreatedAt: nowMs(), UpdatedAt: nowMs()}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO uploads (id, user_id, size, received, created_at, updated_at) VALUES (?,?,?,0,?,?)`,
		int64(u.ID), int64(userID), size, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// UploadByID loads one transfer.
func (s *Store) UploadByID(ctx context.Context, id ids.ID) (*Upload, error) {
	var u Upload
	var blob sql.NullInt64
	err := s.db.R.QueryRowContext(ctx, `SELECT id, user_id, size, received, created_at, updated_at, blob_id FROM uploads WHERE id = ?`, int64(id)).
		Scan(&u.ID, &u.UserID, &u.Size, &u.Received, &u.CreatedAt, &u.UpdatedAt, &blob)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	u.BlobID = idPtr(blob)
	return &u, err
}

// AdvanceUpload records more bytes, but only from the offset we expect: two
// requests carrying the same piece must not both count.
func (s *Store) AdvanceUpload(ctx context.Context, id ids.ID, from, to int64) (bool, error) {
	res, err := s.db.W.ExecContext(ctx, `UPDATE uploads SET received = ?, updated_at = ? WHERE id = ? AND received = ?`, to, nowMs(), int64(id), from)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// FinishUpload records the blob a transfer became. The row stays until the
// stale sweep, so a repeated finish can answer with the same blob.
func (s *Store) FinishUpload(ctx context.Context, id, blobID ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE uploads SET blob_id = ?, updated_at = ? WHERE id = ?`, int64(blobID), nowMs(), int64(id))
	return err
}

// DeleteUpload forgets a transfer.
func (s *Store) DeleteUpload(ctx context.Context, id ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM uploads WHERE id = ?`, int64(id))
	return err
}

// StaleUploads lists transfers nothing has touched since before cutoff.
func (s *Store) StaleUploads(ctx context.Context, cutoff int64) ([]ids.ID, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT id FROM uploads WHERE updated_at < ?`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ids.ID{}
	for rows.Next() {
		var id ids.ID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
