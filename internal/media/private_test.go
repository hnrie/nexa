package media

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestSniffVideo(t *testing.T) {
	box := func(brand string) []byte {
		return append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p'}, []byte(brand+"\x00\x00\x02\x00")...)
	}
	webm := append([]byte{0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84}, []byte("webm")...)
	mkv := append([]byte{0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88}, []byte("matroska")...)
	for _, c := range []struct {
		name string
		head []byte
		mime string
	}{
		{"mp4", box("isom"), "video/mp4"},
		{"iphone", box("mp42"), "video/mp4"},
		{"quicktime", box("qt  "), "video/quicktime"},
		{"webm", webm, "video/webm"},
		{"heic picture", box("heic"), ""},
		{"avif picture", box("avif"), ""},
		{"m4a sound", box("M4A "), ""},
		{"matroska", mkv, ""},
		{"png", pngBytes(2, 2), ""},
		{"short", []byte{0, 0, 0}, ""},
	} {
		mime, ok := SniffVideo(c.head)
		if mime != c.mime || ok != (c.mime != "") {
			t.Errorf("%s: %q %v, want %q", c.name, mime, ok, c.mime)
		}
	}
}

func TestPutPrivate(t *testing.T) {
	m, st := newMedia(t)
	ctx := context.Background()
	lim := PrivateLimits{ImageBytes: 1 << 20, VideoBytes: 2 << 20, MaxSide: 256, MaxPixels: 40_000}
	owner, other := ids.New(), ids.New()
	pic := pngBytes(64, 32)

	a, err := m.PutPrivate(ctx, "bug", bytes.NewReader(pic), lim, owner)
	if err != nil {
		t.Fatal(err)
	}
	if a.Mime != "image/png" || *a.Width != 64 || *a.Height != 32 || a.RefCount != 0 || a.Encrypted || *a.OwnerID != owner {
		t.Fatalf("picture row %+v", a)
	}
	// the same bytes from someone else are a row of their own, sharing the file
	b, err := m.PutPrivate(ctx, "bug", bytes.NewReader(pic), lim, other)
	if err != nil || b.ID == a.ID || *b.OwnerID != other || shaOf(a) != shaOf(b) {
		t.Fatalf("second upload %+v %v", b, err)
	}
	if err := m.Remove(ctx, a); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(m.Path(shaOf(b))); err != nil {
		t.Fatalf("removing one row took the file the other still uses: %v", err)
	}

	vid := append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, bytes.Repeat([]byte{3}, 1000)...)
	v, err := m.PutPrivate(ctx, "bug", bytes.NewReader(vid), lim, owner)
	if err != nil || v.Mime != "video/mp4" || v.Width != nil {
		t.Fatalf("video %+v %v", v, err)
	}

	for name, c := range map[string]struct {
		body []byte
		want error
	}{
		"text":           {[]byte("just some words"), ErrUnsupported},
		"empty":          {nil, ErrUnsupported},
		"big picture":    {append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 1<<20)...), ErrImageTooLarge},
		"big video":      {append(vid[:12:12], bytes.Repeat([]byte{1}, 2<<20)...), ErrTooLarge},
		"wide picture":   {pngBytes(300, 10), ErrBadDimensions},
		"many pixels":    {pngBytes(250, 250), ErrBadDimensions},
		"broken picture": {[]byte("\x89PNG\r\n\x1a\nnot really"), ErrUnsupported},
	} {
		if _, err := m.PutPrivate(ctx, "bug", bytes.NewReader(c.body), lim, owner); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}

	// served as what it is, never as a page, and shrunk when asked
	rec := httptest.NewRecorder()
	m.ServePrivate(rec, httptest.NewRequest("GET", "/media/bugs/x", nil), b, 0)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), pic) ||
		rec.Header().Get("Content-Security-Policy") == "" || rec.Header().Get("Cache-Control") != "private, max-age=86400" {
		t.Fatalf("serve: %d %v", rec.Code, rec.Header())
	}
	rec = httptest.NewRecorder()
	m.ServePrivate(rec, httptest.NewRequest("GET", "/media/bugs/x?size=16", nil), b, 16)
	if rec.Code != 200 || bytes.Equal(rec.Body.Bytes(), pic) {
		t.Fatalf("thumbnail: %d, %d bytes", rec.Code, rec.Body.Len())
	}
	if _, err := st.BlobByID(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
}
