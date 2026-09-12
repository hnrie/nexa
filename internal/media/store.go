package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const sniffBytes = 1 << 20

// Store keeps blob bytes on disk (content-addressed) and metadata in the store.
type Store struct {
	Dir string
	st  *store.Store
}

// New creates the directory layout under dir.
func New(dir string, st *store.Store) (*Store, error) {
	for _, sub := range []string{"tmp", "blobs"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o750); err != nil {
			return nil, err
		}
	}
	return &Store{Dir: dir, st: st}, nil
}

// Path returns where a blob's bytes live.
func (m *Store) Path(sha string) string {
	if len(sha) < 4 {
		return filepath.Join(m.Dir, "blobs", "xx", sha)
	}
	return filepath.Join(m.Dir, "blobs", sha[:2], sha[2:4], sha)
}

// spool copies r to a temp file (bounded by max+1 bytes) while hashing.
func (m *Store) spool(r io.Reader, max int64) (path string, sha string, size int64, err error) {
	f, err := os.CreateTemp(filepath.Join(m.Dir, "tmp"), "upload-*")
	if err != nil {
		return "", "", 0, err
	}
	path = f.Name()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(r, max+1))
	cerr := f.Close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(path)
		return "", "", 0, err
	}
	if n > max {
		os.Remove(path)
		return "", "", 0, ErrTooLarge
	}
	return path, hex.EncodeToString(h.Sum(nil)), n, nil
}

// PutPublic validates an image upload and stores it under kind.
func (m *Store) PutPublic(ctx context.Context, kind string, r io.Reader, lim Limits, owner ids.ID) (*store.Blob, error) {
	tmp, sha, size, err := m.spool(r, lim.MaxBytes)
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp)
	if size == 0 {
		return nil, ErrUnsupported
	}
	f, err := os.Open(tmp)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	head := make([]byte, sniffBytes)
	n, _ := io.ReadFull(f, head)
	head = head[:n]
	mime, animated, ok := Sniff(head)
	if !ok {
		return nil, ErrUnsupported
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	w, h, err := ImageDims(f)
	if err != nil {
		return nil, err
	}
	if err := lim.Check(w, h); err != nil {
		return nil, err
	}
	if existing, err := m.st.BlobBySHA(ctx, sha, kind); err == nil {
		if err := m.st.AddBlobRef(ctx, existing.ID, 1); err != nil {
			return nil, err
		}
		existing.RefCount++
		return existing, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if err := m.commit(tmp, sha); err != nil {
		return nil, err
	}
	ow := owner
	b := &store.Blob{SHA256: sha, Size: size, Mime: mime, Kind: kind, Encrypted: false, RefCount: 1, OwnerID: &ow, Width: &w, Height: &h, Animated: animated}
	if err := m.st.InsertBlob(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

// PutEncrypted stores opaque ciphertext as an unattached attachment (ref 0).
func (m *Store) PutEncrypted(ctx context.Context, r io.Reader, max int64, owner ids.ID) (*store.Blob, error) {
	tmp, sha, size, err := m.spool(r, max)
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp)
	if size == 0 {
		return nil, ErrUnsupported
	}
	if err := m.commit(tmp, sha); err != nil {
		return nil, err
	}
	ow := owner
	// Random IVs make every ciphertext unique, so no dedupe: give each upload its own row.
	b := &store.Blob{SHA256: sha + "-" + ids.New().String(), Size: size, Mime: "application/octet-stream", Kind: "attachment", Encrypted: true, RefCount: 0, OwnerID: &ow}
	if err := m.st.InsertBlob(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

// commit moves a spooled file into its content-addressed place.
func (m *Store) commit(tmp, sha string) error {
	dst := m.Path(sha)
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		return nil // already present (same bytes)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return fmt.Errorf("commit blob: %w", err)
	}
	return nil
}

// Open returns the file for a blob id.
func (m *Store) Open(ctx context.Context, id ids.ID) (*os.File, *store.Blob, error) {
	b, err := m.st.BlobByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(m.Path(shaOf(b)))
	if err != nil {
		return nil, nil, store.ErrNotFound
	}
	return f, b, nil
}

// shaOf strips the uniqueness suffix used by encrypted blobs.
func shaOf(b *store.Blob) string {
	if len(b.SHA256) > 64 {
		return b.SHA256[:64]
	}
	return b.SHA256
}

// Remove deletes a blob's metadata and, when no other row shares the same
// bytes, the file.
func (m *Store) Remove(ctx context.Context, b *store.Blob) error {
	if err := m.st.DeleteBlob(ctx, b.ID); err != nil {
		return err
	}
	n, err := m.st.CountBlobsByContent(ctx, shaOf(b))
	if err != nil {
		return err
	}
	if n == 0 {
		_ = os.Remove(m.Path(shaOf(b)))
	}
	return nil
}

// GC removes unreferenced blobs older than olderThan (unix ms). Returns the count.
func (m *Store) GC(ctx context.Context, olderThan int64) (int, error) {
	list, err := m.st.UnreferencedBlobs(ctx, olderThan)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, b := range list {
		if err := m.Remove(ctx, b); err == nil {
			n++
		}
	}
	return n, nil
}
