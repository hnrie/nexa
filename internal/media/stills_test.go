package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"net/http/httptest"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// Two frames each, 16×8, made with libwebp: the first frame red, the second
// blue. The lossy one's first frame is half see-through, so it carries an
// ALPH chunk before its VP8 data; the lossless one's is opaque VP8L.
const (
	animWebPLossy    = "UklGRugAAABXRUJQVlA4WAoAAAASAAAADwAABwAAQU5JTQYAAAAAAAAAAABBTk1GZAAAAAAAAAAAAA8AAAcAAGQAAAJBTFBICgAAAAEHUMCICERE/wNWUDggOgAAALABAJ0BKhAACAAAwBIloAADXxQWlwAA/v1REJ//93m//7nz//ufP+L3//+tHP//V0X//V0X/rKwAABBTk1GUAAAAAAAAAAAAA8AAAcAAGQAAABWUDggOAAAAJQBAJ0BKhAACAAAABIloAADXxDkIAD+/8JX9C///60c//9XRf/9XRf+tHP//lK/+v3/X7qcAAAA"
	animWebPLossless = "UklGRoQAAABXRUJQVlA4WAoAAAASAAAADwAABwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAA8AAAcAAGQAAAJWUDhMDwAAAC8PwAEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAA8AAAcAAGQAAAJWUDhMDwAAAC8PwAEQBxDR/wIGIqL/AQA="
	// 520×8, wider than an animation is ever shrunk at
	animWebPWide = "UklGRoQAAABXRUJQVlA4WAoAAAACAAAABwIABwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAcCAAcAAGQAAAJWUDhMDwAAAC8HwgEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcCAAcAAGQAAABWUDhMDwAAAC8HwgEABxDR//4HIqL/AQA="
)

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// redThenBlue is a two-frame GIF, red then blue, side by side.
func redThenBlue(side int) []byte {
	pal := color.Palette{color.RGBA{255, 0, 0, 255}, color.RGBA{0, 0, 255, 255}}
	g := &gif.GIF{}
	for i := 0; i < 2; i++ {
		img := image.NewPaletted(image.Rect(0, 0, side, side), pal)
		for p := range img.Pix {
			img.Pix[p] = uint8(i)
		}
		g.Image = append(g.Image, img)
		g.Delay = append(g.Delay, 10)
	}
	var buf bytes.Buffer
	_ = gif.EncodeAll(&buf, g)
	return buf.Bytes()
}

func TestFirstWebPFrame(t *testing.T) {
	for name, src := range map[string]string{"lossy with alpha": animWebPLossy, "lossless": animWebPLossless} {
		img, err := firstWebPFrame(mustB64(t, src))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if b := img.Bounds(); b.Dx() != 16 || b.Dy() != 8 {
			t.Fatalf("%s: %v", name, b)
		}
		c := color.NRGBAModel.Convert(img.At(8, 4)).(color.NRGBA)
		if c.R < 200 || c.G > 60 || c.B > 60 {
			t.Errorf("%s: the first frame is red, got %d,%d,%d", name, c.R, c.G, c.B)
		}
		if name == "lossy with alpha" && (c.A < 100 || c.A > 160) {
			t.Errorf("%s: alpha %d, want about 128", name, c.A)
		}
	}
	if _, err := firstWebPFrame([]byte("RIFF\x04\x00\x00\x00WEBP")); err == nil {
		t.Error("a WebP without frames has no first frame")
	}
	if _, err := firstWebPFrame([]byte("RIFF\x10\x00\x00\x00WEBPANMF\xff\xff\xff\x7f")); err == nil {
		t.Error("a chunk longer than the file is refused")
	}
}

func TestStillsOfMovingStickers(t *testing.T) {
	m, _ := newMedia(t)
	ctx := context.Background()
	lim := Limits{MaxBytes: 10 << 20, MaxW: 1024, MaxH: 1024}
	serve := func(id ids.ID, size int, still bool) (*httptest.ResponseRecorder, image.Image, string) {
		t.Helper()
		rec := httptest.NewRecorder()
		if !m.ServePublicSized(rec, httptest.NewRequest("GET", "/media/sticker/x", nil), "sticker", id, size, still) {
			t.Fatal("not served")
		}
		img, format, _ := image.Decode(bytes.NewReader(rec.Body.Bytes()))
		return rec, img, format
	}
	animated := redThenBlue(64)
	g, err := m.PutPublic(ctx, "sticker", bytes.NewReader(animated), lim, ids.New())
	if err != nil || !g.Animated {
		t.Fatal(err, g)
	}
	// a small animation asked for at a size still moves
	if rec, _, _ := serve(g.ID, 32, false); !bytes.Equal(rec.Body.Bytes(), animated) {
		t.Error("without still, a small animation is served as it is")
	}
	// still: its first frame, at the size asked for
	rec, img, format := serve(g.ID, 32, true)
	if img == nil || format == "gif" || img.Bounds().Dx() != 32 || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("still: %s %v %v", format, img, rec.Header())
	}
	if r, _, b, _ := img.At(16, 16).RGBA(); r>>8 < 200 || b>>8 > 60 {
		t.Errorf("the still is the first (red) frame: %d %d", r>>8, b>>8)
	}
	// never blown up past its own size
	if _, img, _ = serve(g.ID, 256, true); img == nil || img.Bounds().Dx() != 64 {
		t.Errorf("still larger than the animation: %v", img)
	}
	// no size: a still at its own size
	if _, img, _ = serve(g.ID, 0, true); img == nil || img.Bounds().Dx() != 64 {
		t.Errorf("still without a size: %v", img)
	}
	// an animated WebP, which the image package cannot read on its own
	w, err := m.PutPublic(ctx, "sticker", bytes.NewReader(mustB64(t, animWebPLossy)), lim, ids.New())
	if err != nil || !w.Animated {
		t.Fatal(err, w)
	}
	if _, img, format = serve(w.ID, 16, true); img == nil || format != "png" || img.Bounds().Dx() != 16 || img.Bounds().Dy() != 8 {
		t.Errorf("webp still: %s %v", format, img)
	}
	// a wide animated WebP keeps moving when asked for smaller, as it always
	// has (only a still is a still); a GIF that wide becomes one, as before
	wide := mustB64(t, animWebPWide)
	ww, err := m.PutPublic(ctx, "sticker", bytes.NewReader(wide), lim, ids.New())
	if err != nil || !ww.Animated || *ww.Width != 520 {
		t.Fatal(err, ww)
	}
	if rec, _, _ := serve(ww.ID, 128, false); !bytes.Equal(rec.Body.Bytes(), wide) {
		t.Error("a wide animated WebP asked for at a size is served as it is")
	}
	// its first frame is opaque, so the still is a JPEG
	if _, img, format = serve(ww.ID, 128, true); img == nil || format != "jpeg" || img.Bounds().Dx() != 128 {
		t.Errorf("wide webp still: %s", format)
	}
	// a picture that does not move is unaffected by still
	flat := pngBytes(64, 64)
	f, err := m.PutPublic(ctx, "sticker", bytes.NewReader(flat), lim, ids.New())
	if err != nil {
		t.Fatal(err)
	}
	if rec, _, _ := serve(f.ID, 128, true); !bytes.Equal(rec.Body.Bytes(), flat) {
		t.Error("a still picture that fits is served as it is")
	}
}
