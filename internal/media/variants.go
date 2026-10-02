package media

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"golang.org/x/image/draw"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Pictures are shown far smaller than people upload them: a 4096-pixel
// avatar drawn at 32 pixels still costs the browser 64 MB once decoded, and it
// keeps several such copies. So a public image can be asked for at a size,
// and a copy that size is made once, kept on disk, and served from then on.

const (
	minVariant = 16
	maxVariant = 1024
	// an animation larger than this is shown still once shrunk: resizing
	// every frame is not worth it for the rare upload that big
	maxAnimatedSide = 512
)

// variantWork bounds how many images are decoded at once; a large one takes
// a few hundred megabytes while it is being shrunk.
var variantWork = make(chan struct{}, 2)

// VariantSize turns a requested size into the size a copy is made at: the
// next power of two, within [minVariant, maxVariant]. Zero means none.
func VariantSize(raw string) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0
	}
	size := minVariant
	for size < n && size < maxVariant {
		size *= 2
	}
	return size
}

// variantPath is where the copy of a blob at size lives.
func (m *Store) variantPath(sha string, size int, ext string) string {
	return filepath.Join(m.Dir, "variants", sha[:2], fmt.Sprintf("%s-%d.%s", sha, size, ext))
}

// removeVariants deletes every copy made of a blob's bytes.
func (m *Store) removeVariants(sha string) {
	if len(sha) < 2 {
		return
	}
	matches, _ := filepath.Glob(filepath.Join(m.Dir, "variants", sha[:2], sha+"-*"))
	for _, p := range matches {
		_ = os.Remove(p)
	}
}

// ServePublicSized serves a public blob no larger than size on either side,
// making and keeping the copy the first time it is asked for. An image
// already that small, or an animation small enough to leave moving, is served
// as it is. still asks for a moving picture's first frame instead (a grid of
// stickers shows them still until one is pointed at, and a frame weighs a
// fraction of the whole animation); it only applies to the picture formats,
// since Lottie and video cannot be drawn here.
func (m *Store) ServePublicSized(w http.ResponseWriter, r *http.Request, kind string, id ids.ID, size int, still bool) bool {
	b, err := m.st.BlobByID(r.Context(), id)
	if err != nil || b.Kind != kind || b.Encrypted || b.Blocked || !PublicKinds[kind] {
		return false
	}
	width, height := 0, 0
	if b.Width != nil && b.Height != nil {
		width, height = *b.Width, *b.Height
	}
	still = still && b.Animated && stillable[b.Mime] && width > 0 && height > 0
	if still && size <= 0 {
		size = VariantSize(strconv.Itoa(max(width, height)))
	}
	if !still && (size <= 0 || width == 0 || height == 0 || (width <= size && height <= size)) {
		return m.ServePublic(w, r, kind, id)
	}
	// An animated WebP never had a shrunk copy (it could not be read here
	// before its first frame could), so it keeps moving at every size, as it
	// always has; only a still is asked for explicitly.
	if !still && b.Animated && ((width <= maxAnimatedSide && height <= maxAnimatedSide) || b.Mime == "image/webp") {
		return m.ServePublic(w, r, kind, id)
	}
	path, mime, err := m.variant(r.Context(), b, size)
	if err != nil {
		// a picture that cannot be shrunk is still better than none
		return m.ServePublic(w, r, kind, id)
	}
	f, err := os.Open(path)
	if err != nil {
		return m.ServePublic(w, r, kind, id)
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("ETag", `"`+shaOf(b)+"-"+strconv.Itoa(size)+`"`)
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.UnixMilli(b.CreatedAt), f)
	return true
}

// variant returns the copy of b at size, making it if it does not exist yet.
func (m *Store) variant(ctx context.Context, b *store.Blob, size int) (string, string, error) {
	sha := shaOf(b)
	for _, c := range []struct{ ext, mime string }{{"jpg", "image/jpeg"}, {"png", "image/png"}} {
		if p := m.variantPath(sha, size, c.ext); fileExists(p) {
			return p, c.mime, nil
		}
	}
	select {
	case variantWork <- struct{}{}:
		defer func() { <-variantWork }()
	case <-ctx.Done():
		return "", "", ctx.Err()
	}
	// someone may have made it while this waited its turn
	for _, c := range []struct{ ext, mime string }{{"jpg", "image/jpeg"}, {"png", "image/png"}} {
		if p := m.variantPath(sha, size, c.ext); fileExists(p) {
			return p, c.mime, nil
		}
	}
	img, err := decodeFirstFrame(m.Path(sha), b.Mime)
	if err != nil {
		return "", "", err
	}
	small := shrink(img, size)
	ext, mime := "png", "image/png"
	if opaque(small) {
		ext, mime = "jpg", "image/jpeg"
	}
	dst := m.variantPath(sha, size, ext)
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return "", "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".variant-*")
	if err != nil {
		return "", "", err
	}
	defer os.Remove(tmp.Name())
	if ext == "jpg" {
		err = jpeg.Encode(tmp, small, &jpeg.Options{Quality: 90})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(tmp, small)
	}
	// a variant is served as immutable once it exists, so a truncated one
	// would be served truncated for good
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", "", err
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return "", "", err
	}
	return dst, mime, nil
}

// shrink scales img down to fit within size×size, keeping its shape. One
// already that small keeps its size: a still of a small animation is not
// blown up to the size it was asked for.
func shrink(img image.Image, size int) *image.NRGBA {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= size && h <= size {
		out := image.NewNRGBA(image.Rect(0, 0, w, h))
		draw.Draw(out, out.Bounds(), img, b.Min, draw.Src)
		return out
	}
	if w >= h {
		h = max(1, h*size/w)
		w = size
	} else {
		w = max(1, w*size/h)
		h = size
	}
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(out, out.Bounds(), img, b, draw.Src, nil)
	return out
}

// opaque reports whether every pixel is fully opaque, so JPEG loses nothing.
func opaque(img *image.NRGBA) bool {
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] != 0xff {
			return false
		}
	}
	return true
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.Mode().IsRegular()
}
