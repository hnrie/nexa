package media

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"net/http/httptest"
	"strings"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// bannerGIF is an 800×400 animation the way GIF tools write them: a whole red
// first frame, then a blue square in the top-left corner that is cleared away
// once shown, then a green square in the bottom-right that stays, then a
// yellow square that puts back what was under it.
func bannerGIF() []byte {
	pal := color.Palette{color.RGBA{255, 0, 0, 255}, color.RGBA{0, 0, 255, 255}, color.RGBA{0, 255, 0, 255}, color.RGBA{255, 255, 0, 255}}
	fill := func(r image.Rectangle, i uint8) *image.Paletted {
		img := image.NewPaletted(r, pal)
		for p := range img.Pix {
			img.Pix[p] = i
		}
		return img
	}
	g := &gif.GIF{
		Image: []*image.Paletted{
			fill(image.Rect(0, 0, 800, 400), 0),
			fill(image.Rect(0, 0, 100, 100), 1),
			fill(image.Rect(700, 300, 800, 400), 2),
			fill(image.Rect(350, 150, 450, 250), 3),
		},
		Delay:     []int{5, 7, 9, 11},
		Disposal:  []byte{gif.DisposalNone, gif.DisposalBackground, gif.DisposalNone, gif.DisposalPrevious},
		LoopCount: 0,
		Config:    image.Config{Width: 800, Height: 400},
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func TestAnimatedBannerKeepsMovingWhenShrunk(t *testing.T) {
	m, _ := newMedia(t)
	src := bannerGIF()
	b, err := m.PutPublic(context.Background(), "banner", bytes.NewReader(src), Limits{MaxBytes: 10 << 20, MaxW: 4096, MaxH: 4096}, ids.New())
	if err != nil || !b.Animated {
		t.Fatal(err, b)
	}
	serve := func(size int, still bool) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		if !m.ServePublicSized(rec, httptest.NewRequest("GET", "/media/banner/x", nil), "banner", b.ID, size, still) {
			t.Fatal("not served")
		}
		return rec
	}

	rec := serve(256, false)
	if ct := rec.Header().Get("Content-Type"); ct != "image/gif" || !strings.HasSuffix(rec.Header().Get("ETag"), `-256-moving"`) {
		t.Fatalf("served as %q, etag %q", ct, rec.Header().Get("ETag"))
	}
	if bytes.Equal(rec.Body.Bytes(), src) {
		t.Fatal("served the original rather than a shrunk copy")
	}
	g, err := gif.DecodeAll(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Image) != 4 || g.Config.Width != 256 || g.Config.Height != 128 || g.LoopCount != 0 {
		t.Fatalf("frames %d, %dx%d, loop %d", len(g.Image), g.Config.Width, g.Config.Height, g.LoopCount)
	}
	for i, d := range []int{5, 7, 9, 11} {
		if g.Delay[i] != d {
			t.Errorf("frame %d delay %d, want %d", i, g.Delay[i], d)
		}
		if bnd := g.Image[i].Bounds(); bnd.Dx() != 256 || bnd.Dy() != 128 {
			t.Errorf("frame %d is %v, want the whole picture", i, bnd)
		}
	}
	rgba := func(frame, x, y int) (uint32, uint32, uint32, uint32) {
		r, gg, bb, a := g.Image[frame].At(x, y).RGBA()
		return r >> 8, gg >> 8, bb >> 8, a >> 8
	}
	want := func(frame, x, y int, r, gg, bb, a uint32, what string) {
		t.Helper()
		if R, G, B, A := rgba(frame, x, y); R != r || G != gg || B != bb || A != a {
			t.Errorf("frame %d at %d,%d: %d,%d,%d,%d, want %s", frame, x, y, R, G, B, A, what)
		}
	}
	want(0, 128, 64, 255, 0, 0, 255, "red")
	want(1, 10, 10, 0, 0, 255, 255, "the blue square")
	want(1, 128, 64, 255, 0, 0, 255, "red around it")
	// the blue square was cleared after it was shown, to see-through, as browsers do
	want(2, 10, 10, 0, 0, 0, 0, "see-through where the blue square was")
	want(2, 245, 120, 0, 255, 0, 255, "the green square")
	want(3, 128, 64, 255, 255, 0, 255, "the yellow square")
	want(3, 245, 120, 0, 255, 0, 255, "the green square, which stays")

	// made once, then served from disk
	if again := serve(256, false); !bytes.Equal(again.Body.Bytes(), rec.Body.Bytes()) {
		t.Error("a second request gave a different copy")
	}
	// a still is still the first frame, as a JPEG or PNG
	still := serve(256, true)
	if _, format, err := image.Decode(bytes.NewReader(still.Body.Bytes())); err != nil || format == "gif" {
		t.Errorf("still: %s %v", format, err)
	}
	// asked for at its own size or larger, the original
	if big := serve(1024, false); !bytes.Equal(big.Body.Bytes(), src) {
		t.Error("asked for larger than it is, the original")
	}
}

// The same checks as above on shrinkGIF alone, which needs no store (the
// store's uploads only work where chatd runs, not on Windows).
func TestShrinkGIFComposesEveryFrame(t *testing.T) {
	src, err := gif.DecodeAll(bytes.NewReader(bannerGIF()))
	if err != nil {
		t.Fatal(err)
	}
	g, err := shrinkGIF(src, 256)
	if err != nil {
		t.Fatal(err)
	}
	// written and read back, as it is served
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		t.Fatal(err)
	}
	if g, err = gif.DecodeAll(&buf); err != nil {
		t.Fatal(err)
	}
	if len(g.Image) != 4 || g.Config.Width != 256 || g.Config.Height != 128 {
		t.Fatalf("frames %d, %dx%d", len(g.Image), g.Config.Width, g.Config.Height)
	}
	at := func(frame, x, y int) [4]uint32 {
		r, gg, b, a := g.Image[frame].At(x, y).RGBA()
		return [4]uint32{r >> 8, gg >> 8, b >> 8, a >> 8}
	}
	for _, c := range []struct {
		frame, x, y int
		want        [4]uint32
		what        string
	}{
		{0, 128, 64, [4]uint32{255, 0, 0, 255}, "red"},
		{1, 10, 10, [4]uint32{0, 0, 255, 255}, "the blue square"},
		{1, 128, 64, [4]uint32{255, 0, 0, 255}, "red around it"},
		{2, 10, 10, [4]uint32{0, 0, 0, 0}, "see-through where the blue square was"},
		{2, 245, 120, [4]uint32{0, 255, 0, 255}, "the green square"},
		{3, 128, 64, [4]uint32{255, 255, 0, 255}, "the yellow square"},
		{3, 245, 120, [4]uint32{0, 255, 0, 255}, "the green square, which stays"},
	} {
		if got := at(c.frame, c.x, c.y); got != c.want {
			t.Errorf("frame %d at %d,%d: %v, want %s", c.frame, c.x, c.y, got, c.what)
		}
	}
	for i, d := range []int{5, 7, 9, 11} {
		if g.Delay[i] != d {
			t.Errorf("frame %d delay %d, want %d", i, g.Delay[i], d)
		}
	}
}

func TestAnimationTooBigToShrinkIsServedMoving(t *testing.T) {
	g := &gif.GIF{Config: image.Config{Width: 4000, Height: 4000}}
	for i := 0; i < 20; i++ {
		g.Image = append(g.Image, image.NewPaletted(image.Rect(0, 0, 1, 1), color.Palette{color.Black}))
	}
	if _, err := shrinkGIF(g, 256); err != errTooMuchAnimation {
		t.Fatalf("got %v", err)
	}
}
