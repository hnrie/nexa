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

// Avatar-like pictures are cut on the server to the part framed and no
// larger than where they go, and a moving picture stays moving. Pictures
// already that small are kept as they are.
func TestAvatarUploadCropsOnTheServer(t *testing.T) {
	_, ts := newTestServer(t)
	tok, _ := register(t, ts, "alice")
	put := func(url, ctype string, body []byte) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
		req.Header.Set("Content-Type", ctype)
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, b
	}
	get := func(kind, id string) []byte {
		t.Helper()
		res, err := http.Get(ts.URL + "/media/" + kind + "/" + id)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("serve %s: %d", kind, res.StatusCode)
		}
		return b
	}
	// an oversized picture sent with the part framed comes back cut square
	// to no larger than 1024
	big := pngBytes(2048, 2048)
	if code, raw := put(ts.URL+"/api/v1/users/@me/avatar?x=0&y=0&w=2048&h=2048", "image/png", big); code != 200 {
		t.Fatalf("cropped upload: %d %s", code, raw)
	}
	_, me := do(t, ts, "GET", "/api/v1/users/@me", tok, nil)
	data := get("avatar", me["avatar_id"].(string))
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil || cfg.Width != 1024 || cfg.Height != 1024 {
		t.Errorf("cropped avatar: %v %dx%d", err, cfg.Width, cfg.Height)
	}
	// already small enough with nothing framed: the original, untouched
	small := pngBytes(48, 48)
	if code, raw := put(ts.URL+"/api/v1/users/@me/avatar", "image/png", small); code != 200 {
		t.Fatalf("small upload: %d %s", code, raw)
	}
	_, me = do(t, ts, "GET", "/api/v1/users/@me", tok, nil)
	if data := get("avatar", me["avatar_id"].(string)); !bytes.Equal(data, small) {
		t.Error("an image that already fits is kept byte for byte")
	}
	// a role icon is cut to 128
	sid := createServer(t, ts, tok, "Icons")["id"].(string)
	rid := createRole(t, ts, tok, sid, "Mods", 0)
	if code, raw := put(ts.URL+"/api/v1/servers/"+sid+"/roles/"+rid+"/icon?x=0&y=0&w=2048&h=2048", "image/png", big); code != 200 {
		t.Fatalf("role icon: %d %s", code, raw)
	}
	{
		_, got := do(t, ts, "GET", "/api/v1/servers/"+sid+"/roles", tok, nil)
		var iconID string
		for _, r := range got["_list"].([]any) {
			if r.(map[string]any)["id"] == rid {
				iconID, _ = r.(map[string]any)["icon_id"].(string)
			}
		}
		if iconID == "" {
			t.Fatal("role has no icon")
		}
		if data := get("icon", iconID); func() bool {
			cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
			return err != nil || cfg.Width != 128 || cfg.Height != 128
		}() {
			t.Error("role icon is cut to 128 square")
		}
	}
}

// A double tap on Remove releases a shared picture once, and setting the same
// picture again does not leave an extra reference behind.
func TestImageRemovalReleasesOnce(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	pic := pngBytes(24, 24)
	for _, tok := range []string{tokA, tokB, tokA} {
		if res, body := rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "image/png", pic); res.StatusCode != 200 {
			t.Fatalf("avatar: %d %s", res.StatusCode, body)
		}
	}
	_, me := do(t, ts, "GET", "/api/v1/users/@me", tokA, nil)
	avatar, _ := ids.Parse(me["avatar_id"].(string))
	refs := func(id ids.ID) int {
		b, err := srv.Store.BlobByID(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		return b.RefCount
	}
	if n := refs(avatar); n != 2 {
		t.Fatalf("alice and bob share the picture: %d references", n)
	}
	do(t, ts, "DELETE", "/api/v1/users/@me/avatar", tokA, nil)
	do(t, ts, "DELETE", "/api/v1/users/@me/avatar", tokA, nil)
	if n := refs(avatar); n != 1 {
		t.Errorf("bob's reference must survive alice removing hers twice: %d", n)
	}

	sid := createServer(t, ts, tokA, "Icons")["id"].(string)
	for i := 0; i < 2; i++ {
		if res, body := rawPut(t, ts.URL+"/api/v1/servers/"+sid+"/icon", tokA, "image/png", pic); res.StatusCode != 200 {
			t.Fatalf("icon: %d %s", res.StatusCode, body)
		}
	}
	_, view := do(t, ts, "GET", "/api/v1/servers/"+sid, tokA, nil)
	icon, _ := ids.Parse(view["server"].(map[string]any)["icon_id"].(string))
	if n := refs(icon); n != 1 {
		t.Errorf("icon set twice: %d references", n)
	}
	do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/icon", tokA, nil)
	do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/icon", tokA, nil)
	if n := refs(icon); n != 0 {
		t.Errorf("icon removed: %d references", n)
	}
}
