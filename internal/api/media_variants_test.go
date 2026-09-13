package api

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"testing"
)

// photoPNG is fully opaque, like a photo.
func photoPNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func TestPublicImagesComeInTheSizeTheyAreShown(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.MaxAvatarBytes = 8 << 20
	tok, _ := register(t, ts, "alice")
	fetch := func(kind, id, query string) (*http.Response, []byte) {
		t.Helper()
		res, err := http.Get(ts.URL + "/media/" + kind + "/" + id + query)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		return res, data
	}
	upload := func(kind string, body []byte) string {
		t.Helper()
		res, raw := rawPut(t, ts.URL+"/api/v1/users/@me/"+kind, tok, "image/png", body)
		if res.StatusCode != 200 {
			t.Fatalf("upload %s: %d %s", kind, res.StatusCode, raw)
		}
		_, me := do(t, ts, "GET", "/api/v1/users/@me", tok, nil)
		return me[kind+"_id"].(string)
	}

	big := photoPNG(2048, 1024)
	avatar := upload("avatar", big)
	if _, data := fetch("avatar", avatar, ""); !bytes.Equal(data, big) {
		t.Error("without a size, the original is served")
	}
	// asked for 50, it gets the next power of two: 64 across, still 2:1
	res, data := fetch("avatar", avatar, "?size=50")
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if res.StatusCode != 200 || err != nil || cfg.Width != 64 || cfg.Height != 32 || format != "jpeg" || res.Header.Get("Content-Type") != "image/jpeg" || res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("sized copy: %d %v %dx%d %s %v", res.StatusCode, err, cfg.Width, cfg.Height, format, res.Header)
	}
	// made once and kept
	made, _ := filepath.Glob(filepath.Join(srv.Media.Dir, "variants", "*", "*-64.jpg"))
	if len(made) != 1 {
		t.Errorf("copies on disk: %v", made)
	}
	if _, again := fetch("avatar", avatar, "?size=64"); !bytes.Equal(again, data) {
		t.Error("the kept copy is served the second time")
	}
	// see-through pixels stay see-through
	banner := upload("banner", pngBytes(1024, 512))
	res, data = fetch("banner", banner, "?size=128")
	if cfg, format, err = image.DecodeConfig(bytes.NewReader(data)); err != nil || format != "png" || cfg.Width != 128 || cfg.Height != 64 {
		t.Errorf("transparent copy: %v %s %dx%d", err, format, cfg.Width, cfg.Height)
	}
	// already small enough: the original, untouched
	small := pngBytes(48, 48)
	tiny := upload("avatar", small)
	if _, data = fetch("avatar", tiny, "?size=64"); !bytes.Equal(data, small) {
		t.Error("an image that already fits is served as it is")
	}
	// a bad size is ignored rather than refused
	if res, data = fetch("avatar", avatar, "?size=nope"); res.StatusCode != 200 || !bytes.Equal(data, big) {
		t.Errorf("bad size: %d", res.StatusCode)
	}
}
