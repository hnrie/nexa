// Package media validates and stores uploaded files: public images (avatars,
// banners, icons, emoji, stickers) and opaque encrypted attachments.
package media

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"

	_ "golang.org/x/image/webp"
)

var (
	ErrTooLarge    = errors.New("file too large")
	ErrUnsupported = errors.New("unsupported file type")
	// ErrBadOffset means a piece of a resumable upload arrived out of order.
	ErrBadOffset = errors.New("unexpected upload offset")
	// ErrNotFound means the upload being finished has no bytes on disk.
	ErrNotFound      = errors.New("upload not found")
	ErrBadDimensions = errors.New("image dimensions out of range")
	// ErrBlocked means the picture is one the staff took down
	// (store.ImageBlocked): it cannot be uploaded again, as anything.
	ErrBlocked = errors.New("image taken down")
)

// MimeTGS is a Telegram animated sticker: gzip-compressed Lottie JSON. MimeWebM
// is a Telegram video sticker. Both move, so they count as animated wherever
// that matters (variant sizing, client badges).
const (
	MimeTGS  = "application/x-tgsticker"
	MimeWebM = "video/webm"
)

// Sniff identifies an image by its bytes. head should hold the beginning of
// the file (up to 1 MiB is inspected for animation markers).
func Sniff(head []byte) (mime string, animated bool, ok bool) {
	switch {
	case len(head) >= 8 && bytes.Equal(head[:8], []byte("\x89PNG\r\n\x1a\n")):
		return "image/png", bytes.Contains(head, []byte("acTL")), true
	case len(head) >= 3 && head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff:
		return "image/jpeg", false, true
	case len(head) >= 6 && (bytes.Equal(head[:6], []byte("GIF87a")) || bytes.Equal(head[:6], []byte("GIF89a"))):
		return "image/gif", gifFrameCount(head, 2) >= 2, true
	case len(head) >= 16 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")):
		anim := false
		if bytes.Equal(head[12:16], []byte("VP8X")) && len(head) >= 21 {
			anim = head[20]&0x02 != 0
		}
		return "image/webp", anim, true
	case len(head) >= 2 && head[0] == 0x1f && head[1] == 0x8b:
		// gzip: the only thing this server stores in that shape is a Telegram
		// animated sticker, which TgsDims confirms before anything is kept.
		return MimeTGS, true, true
	case len(head) >= 4 && head[0] == 0x1a && head[1] == 0x45 && head[2] == 0xdf && head[3] == 0xa3:
		// EBML: a video sticker. Dimensions are not decoded here; the file
		// plays at its own size and the stored dimensions stay empty.
		return MimeWebM, true, true
	}
	return "", false, false
}

// gifFrameCount walks GIF blocks and counts image descriptors, stopping at max.
func gifFrameCount(b []byte, max int) int {
	if len(b) < 13 {
		return 0
	}
	pos := 13
	packed := b[10]
	if packed&0x80 != 0 { // global colour table
		pos += 3 * (1 << ((packed & 0x07) + 1))
	}
	count := 0
	skipSubBlocks := func() bool {
		for {
			if pos >= len(b) {
				return false
			}
			n := int(b[pos])
			pos++
			if n == 0 {
				return true
			}
			pos += n
		}
	}
	for pos < len(b) && count < max {
		switch b[pos] {
		case 0x21: // extension
			pos += 2
			if !skipSubBlocks() {
				return count
			}
		case 0x2C: // image descriptor
			count++
			if pos+10 > len(b) {
				return count
			}
			lp := b[pos+9]
			pos += 10
			if lp&0x80 != 0 {
				pos += 3 * (1 << ((lp & 0x07) + 1))
			}
			pos++ // LZW minimum code size
			if !skipSubBlocks() {
				return count
			}
		case 0x3B:
			return count
		default:
			return count
		}
	}
	return count
}

// TgsDims reads a Telegram animated sticker's canvas out of its own JSON.
// A .tgs file is gzipped Lottie, and Lottie carries its width and height at
// the top level. Anything that is not gzip, is not JSON, or names no usable
// size is not a sticker.
func TgsDims(r io.Reader) (int, int, error) {
	zr, err := gzip.NewReader(io.LimitReader(r, 1<<20))
	if err != nil {
		return 0, 0, ErrUnsupported
	}
	defer zr.Close()
	var doc struct {
		W float64 `json:"w"`
		H float64 `json:"h"`
	}
	if err := json.NewDecoder(io.LimitReader(zr, 1<<20)).Decode(&doc); err != nil {
		return 0, 0, ErrUnsupported
	}
	if doc.W < 1 || doc.H < 1 || doc.W != float64(int(doc.W)) || doc.H != float64(int(doc.H)) {
		return 0, 0, ErrUnsupported
	}
	return int(doc.W), int(doc.H), nil
}

// ImageDims decodes only the header of an image.
func ImageDims(r io.Reader) (w, h int, err error) {
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return 0, 0, ErrUnsupported
	}
	return cfg.Width, cfg.Height, nil
}

// Limits bounds an upload of a given kind.
type Limits struct {
	MaxBytes int64
	MaxW     int
	MaxH     int
}

// Check verifies dimensions against the limits.
func (l Limits) Check(w, h int) error {
	if w <= 0 || h <= 0 || (l.MaxW > 0 && w > l.MaxW) || (l.MaxH > 0 && h > l.MaxH) {
		return ErrBadDimensions
	}
	return nil
}

var _ = binary.BigEndian
