package media

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Private files are neither end-to-end encrypted nor public: a bug report's
// screenshots and recording, which the team has to be able to see and nobody
// else may. They are stored like public images, as the bytes that were sent,
// but nothing here serves them by address alone. The handler in front checks
// who is asking and then calls ServePrivate.

// ErrVideoTooLarge and ErrImageTooLarge say which of the two caps a private
// upload went over, so the answer can name the right one.
var (
	ErrVideoTooLarge = errors.New("video too large")
	ErrImageTooLarge = errors.New("image too large")
)

// PrivateLimits bounds a private upload. Pictures and videos have caps of
// their own; a picture's size on screen is bounded too, both per side and in
// all, since its thumbnail is made by decoding the whole of it.
type PrivateLimits struct {
	ImageBytes int64
	VideoBytes int64
	MaxSide    int
	MaxPixels  int64
}

// SniffVideo identifies the video containers a browser plays: MP4 and
// QuickTime (an "ftyp" box that does not name a still-image or audio-only
// brand) and WebM (EBML naming the webm doc type).
func SniffVideo(head []byte) (string, bool) {
	if len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")) {
		switch string(head[8:12]) {
		case "qt  ":
			return "video/quicktime", true
		// pictures (HEIC, AVIF) and sound (M4A, audiobooks) share the box
		case "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif", "avis", "M4A ", "M4B ", "M4P ", "F4A ", "F4B ":
			return "", false
		}
		return "video/mp4", true
	}
	if len(head) >= 4 && head[0] == 0x1a && head[1] == 0x45 && head[2] == 0xdf && head[3] == 0xa3 {
		// the doc type sits in the EBML header, within the first few dozen bytes
		n := min(len(head), 256)
		if bytes.Contains(head[:n], []byte("webm")) {
			return "video/webm", true
		}
	}
	return "", false
}

// PutPrivate validates a picture (PNG, JPEG, GIF, WebP) or a video (MP4,
// QuickTime, WebM) and stores it under kind, without its metadata (a WebM
// stays as it came). Each upload gets a row of its own, even when the same
// bytes were sent before, so every file has exactly one owner to check
// access against; the bytes on disk are still shared. It is stored with no
// reference: whatever it is sent with takes one, and the collector removes
// it a day later if nothing ever does.
func (m *Store) PutPrivate(ctx context.Context, kind string, r io.Reader, lim PrivateLimits, owner ids.ID) (*store.Blob, error) {
	tmp, sha, size, err := m.spoolClean(r, max(lim.ImageBytes, lim.VideoBytes))
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
	b := &store.Blob{Size: size, Kind: kind, Encrypted: false, RefCount: 0}
	if mime, animated, ok := Sniff(head); ok && mime != MimeTGS && mime != MimeWebM {
		if size > lim.ImageBytes {
			return nil, ErrImageTooLarge
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
		w, h, err := ImageDims(f)
		if err != nil {
			return nil, err
		}
		if err := (Limits{MaxW: lim.MaxSide, MaxH: lim.MaxSide}).Check(w, h); err != nil {
			return nil, err
		}
		if lim.MaxPixels > 0 && int64(w)*int64(h) > lim.MaxPixels {
			return nil, ErrBadDimensions
		}
		b.Mime, b.Animated, b.Width, b.Height = mime, animated, &w, &h
	} else if mime, ok := SniffVideo(head); ok {
		if size > lim.VideoBytes {
			return nil, ErrVideoTooLarge
		}
		b.Mime = mime
	} else {
		return nil, ErrUnsupported
	}
	unlock := m.lockContent(sha)
	defer unlock()
	if err := m.commit(tmp, sha); err != nil {
		return nil, err
	}
	ow := owner
	b.OwnerID = &ow
	// the suffix keeps the row apart from any other with the same bytes; the
	// file is found by the hash in front of it (shaOf)
	b.SHA256 = sha + "-" + ids.New().String()
	if err := m.st.InsertBlob(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

// ServePrivate writes a private blob whose access the caller has already
// checked. A picture asked for at a size is shrunk to it the way public ones
// are (the copy is kept and shared by content); anything else is served as it
// is, with ranges, so a video can be scrubbed. Nothing shared may cache it,
// and it is never run as a page.
func (m *Store) ServePrivate(w http.ResponseWriter, r *http.Request, b *store.Blob, size int) {
	path, mime := m.Path(shaOf(b)), b.Mime
	etag := `"` + shaOf(b) + `"`
	if size > 0 && b.Width != nil && b.Height != nil && (*b.Width > size || *b.Height > size) && !(b.Animated && *b.Width <= maxAnimatedSide && *b.Height <= maxAnimatedSide) {
		if p, vm, err := m.variant(r.Context(), b, size); err == nil {
			path, mime, etag = p, vm, `"`+shaOf(b)+"-"+strconv.Itoa(size)+`"`
		}
	}
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Cache-Control", "private, max-age=86400")
	h.Set("ETag", etag)
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.UnixMilli(b.CreatedAt), f)
}
