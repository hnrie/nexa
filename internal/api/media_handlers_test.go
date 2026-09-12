package api

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"net/http"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func pngBytes(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

func rawPut(t *testing.T, url, token, ctype string, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func TestAvatarUploadServeDelete(t *testing.T) {
	srv, ts := newTestServer(t)
	tok, _ := register(t, ts, "alice")
	res, body := rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "image/png", pngBytes(32, 32))
	if res.StatusCode != 200 || !bytes.Contains(body, []byte(`"avatar_id":"`)) {
		t.Fatalf("upload: %d %s", res.StatusCode, body)
	}
	_, me := do(t, ts, "GET", "/api/v1/users/@me", tok, nil)
	avatarID := me["avatar_id"].(string)
	get, err := http.Get(ts.URL + "/media/avatar/" + avatarID + ".png")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(get.Body)
	get.Body.Close()
	if get.StatusCode != 200 || get.Header.Get("Content-Type") != "image/png" || get.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" || !bytes.Equal(data, pngBytes(32, 32)) {
		t.Errorf("serve: %d %s %s", get.StatusCode, get.Header.Get("Content-Type"), get.Header.Get("Cache-Control"))
	}
	if get, _ = http.Get(ts.URL + "/media/emoji/" + avatarID); get.StatusCode != 404 {
		t.Error("kind mismatch must 404")
	}
	if get, _ = http.Get(ts.URL + "/media/avatar/999"); get.StatusCode != 404 {
		t.Error("unknown id must 404")
	}
	// replace: old blob loses its reference
	res, _ = rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "image/png", pngBytes(16, 16))
	if res.StatusCode != 200 {
		t.Fatal("replace")
	}
	oldID, _ := ids.Parse(avatarID)
	old, err := srv.Store.BlobByID(t.Context(), oldID)
	if err != nil || old.RefCount != 0 {
		t.Errorf("old avatar ref should drop to 0: %v %+v", err, old)
	}
	if res, body = rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "text/plain", []byte("nope")); res.StatusCode != 400 || !bytes.Contains(body, []byte("unsupported_type")) {
		t.Errorf("text upload: %d %s", res.StatusCode, body)
	}
	if res, body = rawPut(t, ts.URL+"/api/v1/users/@me/banner", tok, "image/png", pngBytes(8, 8)); res.StatusCode != 200 || !bytes.Contains(body, []byte(`"banner_id":"`)) {
		t.Errorf("banner: %d %s", res.StatusCode, body)
	}
	if r2, _ := do(t, ts, "DELETE", "/api/v1/users/@me/avatar", tok, nil); r2.StatusCode != 204 {
		t.Error("delete avatar")
	}
	_, me = do(t, ts, "GET", "/api/v1/users/@me", tok, nil)
	if me["avatar_id"] != nil || me["banner_id"] == nil {
		t.Errorf("after delete: %v", me)
	}
	srv.Cfg.MaxAvatarBytes = 100
	if res, body = rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "image/png", pngBytes(64, 64)); res.StatusCode != 413 || !bytes.Contains(body, []byte("too_large")) {
		t.Errorf("too large: %d %s", res.StatusCode, body)
	}
}
