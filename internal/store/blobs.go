package store

import (
	"context"
	"database/sql"
	"errors"

	"evilion.xyz/chat/internal/ids"
)

const blobCols = `id, sha256, size, mime, kind, encrypted, ref_count, owner_id, width, height, animated, created_at`

func scanBlob(r rowScanner) (*Blob, error) {
	var b Blob
	var enc, anim int64
	var owner, w, h sql.NullInt64
	if err := r.Scan(&b.ID, &b.SHA256, &b.Size, &b.Mime, &b.Kind, &enc, &b.RefCount, &owner, &w, &h, &anim, &b.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	b.Encrypted, b.Animated = enc == 1, anim == 1
	b.OwnerID, b.Width, b.Height = idPtr(owner), intPtr(w), intPtr(h)
	return &b, nil
}

// InsertBlob stores metadata for a new blob (ID/CreatedAt filled when zero).
func (s *Store) InsertBlob(ctx context.Context, b *Blob) error {
	if b.ID.IsZero() {
		b.ID = ids.New()
	}
	if b.CreatedAt == 0 {
		b.CreatedAt = nowMs()
	}
	_, err := s.db.W.ExecContext(ctx, `INSERT INTO blobs (`+blobCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		int64(b.ID), b.SHA256, b.Size, b.Mime, b.Kind, boolInt(b.Encrypted), b.RefCount, nullID(b.OwnerID), nullInt(b.Width), nullInt(b.Height), boolInt(b.Animated), b.CreatedAt)
	return err
}

// BlobBySHA finds a blob with the same content and kind.
func (s *Store) BlobBySHA(ctx context.Context, sha, kind string) (*Blob, error) {
	return scanBlob(s.db.R.QueryRowContext(ctx, `SELECT `+blobCols+` FROM blobs WHERE sha256 = ? AND kind = ?`, sha, kind))
}

// BlobByID loads a blob.
func (s *Store) BlobByID(ctx context.Context, id ids.ID) (*Blob, error) {
	return scanBlob(s.db.R.QueryRowContext(ctx, `SELECT `+blobCols+` FROM blobs WHERE id = ?`, int64(id)))
}

// AddBlobRef changes the reference count by delta (never below zero).
func (s *Store) AddBlobRef(ctx context.Context, id ids.ID, delta int) error {
	_, err := s.db.W.ExecContext(ctx, `UPDATE blobs SET ref_count = max(0, ref_count + ?) WHERE id = ?`, delta, int64(id))
	return err
}

// UnreferencedBlobs lists blobs with no references created before olderThan.
func (s *Store) UnreferencedBlobs(ctx context.Context, olderThan int64) ([]*Blob, error) {
	rows, err := s.db.R.QueryContext(ctx, `SELECT `+blobCols+` FROM blobs WHERE ref_count <= 0 AND created_at < ? LIMIT 500`, olderThan)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Blob
	for rows.Next() {
		b, err := scanBlob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteBlob removes blob metadata.
func (s *Store) DeleteBlob(ctx context.Context, id ids.ID) error {
	_, err := s.db.W.ExecContext(ctx, `DELETE FROM blobs WHERE id = ?`, int64(id))
	return err
}
