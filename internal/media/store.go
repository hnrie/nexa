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
	"sync"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const sniffBytes = 1 << 20

// Store keeps blob bytes on disk (content-addressed) and metadata in the store.
type Store struct {
	Dir string
	st  *store.Store

	locksMu sync.Mutex
	locks   map[ids.ID]*uploadLock
}

type uploadLock struct {
	mu    sync.Mutex
	users int
}

// LockUpload serialises the requests that change one resumable upload: a
// retried piece can arrive while the request it replaced is still stuck on its
// body. It returns the unlock function.
func (m *Store) LockUpload(id ids.ID) func() {
	m.locksMu.Lock()
	if m.locks == nil {
		m.locks = map[ids.ID]*uploadLock{}
	}
	l := m.locks[id]
	if l == nil {
		l = &uploadLock{}
		m.locks[id] = l
	}
	l.users++
	m.locksMu.Unlock()
	l.mu.Lock()
	return func() {
		l.mu.Unlock()
		m.locksMu.Lock()
		if l.users--; l.users == 0 {
			delete(m.locks, id)
		}
		m.locksMu.Unlock()
	}
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

// SpoolPath is where a resumable upload's bytes accumulate.
func (m *Store) SpoolPath(id ids.ID) string {
	return filepath.Join(m.Dir, "tmp", "resume-"+id.String())
}

// StagePiece reads one piece of a resumable upload into a file of its own, so
// a body that never finishes arriving leaves the spool untouched. The caller
// removes the returned file.
func (m *Store) StagePiece(r io.Reader, limit int64) (string, int64, error) {
	f, err := os.CreateTemp(filepath.Join(m.Dir, "tmp"), "piece-*")
	if err != nil {
		return "", 0, err
	}
	path := f.Name()
	n, err := io.Copy(f, io.LimitReader(r, limit+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > limit {
		err = ErrTooLarge
	}
	if err != nil {
		os.Remove(path)
		return "", 0, err
	}
	return path, n, nil
}

// AppendSpool adds a staged piece to a resumable upload at exactly `at`,
// refusing anything that would leave a hole. It returns the new length. The
// caller holds LockUpload and has checked `at` against the database.
func (m *Store) AppendSpool(id ids.ID, at int64, piece string) (int64, error) {
	src, err := os.Open(piece)
	if err != nil {
		return at, err
	}
	defer src.Close()
	f, err := os.OpenFile(m.SpoolPath(id), os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if info.Size() < at {
		// a hole: bytes the database counts are missing from the file
		return info.Size(), ErrBadOffset
	}
	if info.Size() > at {
		// The database only advances once a piece is written and synced, so
		// anything past it was written by a request that never got to record it.
		if err := f.Truncate(at); err != nil {
			return info.Size(), err
		}
	}
	if _, err := f.Seek(at, io.SeekStart); err != nil {
		return at, err
	}
	n, err := io.Copy(f, src)
	if err != nil {
		_ = f.Truncate(at)
		return at, err
	}
	if err := f.Sync(); err != nil {
		return at + n, err
	}
	return at + n, nil
}

// DiscardSpool removes a half-finished upload.
func (m *Store) DiscardSpool(id ids.ID) {
	_ = os.Remove(m.SpoolPath(id))
}

// FinishSpool turns a completed upload of `size` bytes into a blob. The bytes
// are already encrypted by the sender, so they are stored under a name of their
// own rather than hashed for sharing: the same file uploaded twice is two blobs.
func (m *Store) FinishSpool(ctx context.Context, id ids.ID, owner ids.ID, size int64) (*store.Blob, error) {
	path := m.SpoolPath(id)
	info, err := os.Stat(path)
	if err != nil {
		return nil, ErrNotFound
	}
	if info.Size() == 0 {
		m.DiscardSpool(id)
		return nil, ErrUnsupported
	}
	if info.Size() != size {
		// the file on disk is not what the database counted; it would not decrypt
		m.DiscardSpool(id)
		return nil, ErrBadOffset
	}
	name := hex.EncodeToString([]byte(id.String())) + ids.New().String()
	if err := m.commit(path, name); err != nil {
		return nil, err
	}
	ow := owner
	b := &store.Blob{SHA256: name, Size: info.Size(), Mime: "application/octet-stream", Kind: "attachment", Encrypted: true, RefCount: 0, OwnerID: &ow}
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
	deleted, err := m.st.DeleteBlob(ctx, b.ID)
	if err != nil {
		return err
	}
	if !deleted {
		return errReferenced // picked up again since it was listed
	}
	n, err := m.st.CountBlobsByContent(ctx, shaOf(b))
	if err != nil {
		return err
	}
	if n == 0 {
		_ = os.Remove(m.Path(shaOf(b)))
		m.removeVariants(shaOf(b))
	}
	return nil
}

// errReferenced tells GC a blob it listed is in use again and was kept.
var errReferenced = errors.New("blob is referenced again")

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
