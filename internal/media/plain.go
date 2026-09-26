package media

import (
	"context"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// KindWebhookFile is a file a webhook sent. A webhook's message is not
// end-to-end encrypted (whoever holds the URL sends it here readable), so
// neither are its files: they are kept as they came, and served like an
// encrypted attachment is, only to people who can read the channel, as
// bytes the app turns into a picture or a download itself.
const KindWebhookFile = "webhook_file"

// maxSniffSide keeps a picture's recorded size to what a real picture has;
// its header can say anything.
const maxSniffSide = 1 << 15

// PutPlain stores a webhook's file, of any type, with no reference: the
// message it goes out with takes one, and the collector removes it a day
// later if none ever does. declared is the type the sender gave, used when
// the bytes do not say what they are. It returns the blob and the type to
// show it as.
func (m *Store) PutPlain(ctx context.Context, r io.Reader, max int64, owner ids.ID, declared string) (*store.Blob, error) {
	tmp, sha, size, err := m.spool(r, max)
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp)
	f, err := os.Open(tmp)
	if err != nil {
		return nil, err
	}
	head := make([]byte, sniffBytes)
	n, _ := io.ReadFull(f, head)
	head = head[:n]
	b := &store.Blob{Size: size, Kind: KindWebhookFile, Encrypted: false, RefCount: 0}
	if typ, animated, ok := Sniff(head); ok {
		b.Mime, b.Animated = typ, animated
		if typ != MimeTGS && typ != MimeWebM {
			if _, err := f.Seek(0, io.SeekStart); err == nil {
				if w, h, err := ImageDims(f); err == nil && w > 0 && h > 0 && w <= maxSniffSide && h <= maxSniffSide {
					b.Width, b.Height = &w, &h
				}
			}
		}
	} else if typ, ok := SniffVideo(head); ok {
		b.Mime = typ
	} else {
		b.Mime = plainType(declared, head)
	}
	f.Close()
	unlock := m.lockContent(sha)
	defer unlock()
	if err := m.commit(tmp, sha); err != nil {
		return nil, err
	}
	ow := owner
	b.OwnerID = &ow
	// a row of its own, like an encrypted upload's: each file has exactly one
	// message to check access against, while the bytes on disk are shared
	b.SHA256 = sha + "-" + ids.New().String()
	if err := m.st.InsertBlob(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

// plainType is what to call a file whose bytes are not a picture or a video
// this server knows: the type it was sent as, if that is a real one, or else
// what its first bytes look like.
func plainType(declared string, head []byte) string {
	if t, _, err := mime.ParseMediaType(declared); err == nil && strings.Count(t, "/") == 1 && len(t) <= 100 && t != "application/octet-stream" {
		return t
	}
	if len(head) == 0 {
		return "application/octet-stream"
	}
	t, _, _ := mime.ParseMediaType(http.DetectContentType(head))
	if t == "" {
		return "application/octet-stream"
	}
	return t
}
