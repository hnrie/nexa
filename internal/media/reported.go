package media

// A report shares a file's own key, never a conversation key. Decrypt only the
// requested chunks, so even multi-gigabyte reported files support video ranges
// without buffering the whole file or writing a plaintext copy to disk.
import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const reportChunk = int64(4 << 20)

var errReportedFile = errors.New("invalid reported attachment")

type reportedReader struct {
	source      io.ReaderAt
	aead        cipher.AEAD
	base        [8]byte
	size, pos   int64
	cachedIndex int64
	cached      []byte
}

func newReportedReader(source io.ReaderAt, encryptedSize, plainSize int64, key []byte) (*reportedReader, error) {
	chunks := (plainSize + reportChunk - 1) / reportChunk
	if chunks == 0 {
		chunks = 1
	}
	if plainSize < 0 || encryptedSize != 12+plainSize+chunks*20 {
		return nil, errReportedFile
	}
	block, err := aes.NewCipher(key)
	if err != nil || len(key) != 32 {
		return nil, errReportedFile
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	var header [12]byte
	if _, err := source.ReadAt(header[:], 0); err != nil || string(header[:4]) != "ECF1" {
		return nil, errReportedFile
	}
	out := &reportedReader{source: source, aead: aead, size: plainSize, cachedIndex: -1}
	copy(out.base[:], header[4:])
	// Authenticate before writing HTTP headers, including an empty file.
	if err := out.chunk(0); err != nil {
		return nil, err
	}
	return out, nil
}
func (r *reportedReader) chunk(index int64) error {
	if index == r.cachedIndex {
		return nil
	}
	n := min(reportChunk, r.size-index*reportChunk)
	if n < 0 {
		return errReportedFile
	}
	frame := make([]byte, 4+n+16)
	if _, err := r.source.ReadAt(frame, 12+index*(reportChunk+20)); err != nil {
		return err
	}
	if int64(binary.BigEndian.Uint32(frame[:4])) != n+16 {
		return errReportedFile
	}
	var nonce [12]byte
	copy(nonce[:8], r.base[:])
	binary.BigEndian.PutUint32(nonce[8:], uint32(index))
	plain, err := r.aead.Open(nil, nonce[:], frame[4:], []byte("file/v1"))
	if err != nil {
		return err
	}
	r.cached, r.cachedIndex = plain, index
	return nil
}
func (r *reportedReader) Read(p []byte) (int, error) {
	if r.pos >= r.size {
		return 0, io.EOF
	}
	if err := r.chunk(r.pos / reportChunk); err != nil {
		return 0, err
	}
	n := copy(p, r.cached[r.pos%reportChunk:])
	r.pos += int64(n)
	return n, nil
}
func (r *reportedReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		offset += r.pos
	case io.SeekEnd:
		offset += r.size
	default:
		return 0, errReportedFile
	}
	if offset < 0 {
		return 0, errReportedFile
	}
	r.pos = offset
	return offset, nil
}
func (m *Store) ServeReportedAttachment(w http.ResponseWriter, r *http.Request, b *store.Blob, key []byte, size int64, mime string) {
	f, _, err := m.Open(r.Context(), b.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	var content io.ReadSeeker = f
	if b.Encrypted {
		content, err = newReportedReader(f, b.Size, size, key)
		if err != nil {
			http.Error(w, "Reported attachment could not be decrypted", http.StatusUnprocessableEntity)
			return
		}
	}
	// Never let a reported document run as an app-origin page.
	mime = reportedType(mime)
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Cache-Control", "private, no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.UnixMilli(b.CreatedAt), content)
}

// Reject an incorrect file key or truncated framing before accepting a report.
func (m *Store) ValidateReportedAttachment(ctx context.Context, id ids.ID, key []byte, size int64) error {
	f, b, err := m.Open(ctx, id)
	if err != nil {
		return err
	}
	defer f.Close()
	if !b.Encrypted {
		if size != b.Size {
			return errReportedFile
		}
		return nil
	}
	_, err = newReportedReader(f, b.Size, size, key)
	return err
}

func reportedType(value string) string {
	kind, _, err := mime.ParseMediaType(value)
	if err != nil {
		return "application/octet-stream"
	}
	switch kind {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif":
		return kind
	}
	if strings.HasPrefix(kind, "video/") || strings.HasPrefix(kind, "audio/") {
		return kind
	}
	return "application/octet-stream"
}
