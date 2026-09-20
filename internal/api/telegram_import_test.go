package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"evilion.xyz/chat/internal/telegram"
)

// mockTelegramSet serves a fake Bot API: a set of four stickers (a picture, an
// animated one, a video one, and one whose file is missing) plus the files
// for the first three.
func mockTelegramSet(t *testing.T) *httptest.Server {
	t.Helper()
	png := pngBytes(64, 64)
	var tgs bytes.Buffer
	zw := gzip.NewWriter(&tgs)
	_, _ = zw.Write([]byte(`{"v":"5.5.2","fr":30,"w":512,"h":512,"layers":[]}`))
	_ = zw.Close()
	webm := append([]byte{0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81}, bytes.Repeat([]byte{0}, 64)...)
	files := map[string][]byte{"pictures/a.png": png, "animated/b.tgs": tgs.Bytes(), "video/c.webm": webm}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok := func(v any) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": v})
		}
		fail := func(desc string) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "description": desc})
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/getStickerSet"):
			if r.URL.Query().Get("name") != "dennicat" {
				fail("Bad Request: STICKERSET_INVALID")
				return
			}
			ok(map[string]any{
				"name":  "dennicat",
				"title": "Denni",
				"stickers": []any{
					map[string]any{"file_id": "f1", "emoji": "🥳", "width": 512, "height": 512},
					map[string]any{"file_id": "f2", "emoji": "😎", "width": 512, "height": 512, "is_animated": true},
					map[string]any{"file_id": "f3", "emoji": "", "width": 512, "height": 512, "is_video": true},
					map[string]any{"file_id": "f4", "emoji": "😢", "width": 512, "height": 512},
				},
			})
		case strings.HasSuffix(r.URL.Path, "/getFile"):
			fid := r.URL.Query().Get("file_id")
			paths := map[string]string{"f1": "pictures/a.png", "f2": "animated/b.tgs", "f3": "video/c.webm"}
			if p, ok := paths[fid]; ok {
				ok2 := func(v any) {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": v})
				}
				ok2(map[string]any{"file_id": fid, "file_path": p})
				return
			}
			fail("Bad Request: invalid file id")
		case strings.HasPrefix(r.URL.Path, "/file/"):
			for p, b := range files {
				if strings.HasSuffix(r.URL.Path, p) {
					w.Write(b)
					return
				}
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

func TestTelegramImport(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")

	// without a token the endpoint says it is not set up, and a bad link is
	// rejected before anything talks to Telegram
	if res, _ := do(t, ts, "POST", "/api/v1/stickers/packs/import/telegram", tokA, map[string]any{"url": "https://t.me/addstickers/dennicat"}); res.StatusCode != 501 {
		t.Fatalf("no token: %d", res.StatusCode)
	}
	srv.Cfg.TelegramBotToken = "test-token"
	if res, body := do(t, ts, "POST", "/api/v1/stickers/packs/import/telegram", tokA, map[string]any{"url": "not a link"}); res.StatusCode != 400 || body["error"].(map[string]any)["code"] != "invalid_pack_link" {
		t.Fatalf("bad link: %d %v", res.StatusCode, body)
	}

	oldAPI, oldFile := telegram.APIBase, telegram.FileBase
	m := mockTelegramSet(t)
	telegram.APIBase = m.URL
	telegram.FileBase = m.URL + "/file"
	t.Cleanup(func() { telegram.APIBase, telegram.FileBase = oldAPI, oldFile })

	// an unknown set is Telegram's own error, passed through as a 502
	if res, _ := do(t, ts, "POST", "/api/v1/stickers/packs/import/telegram", tokA, map[string]any{"url": "https://t.me/addstickers/nosuchset"}); res.StatusCode != 502 {
		t.Fatalf("unknown set: %d", res.StatusCode)
	}

	res, lines := postImport(t, ts, tokA, "https://t.me/addstickers/dennicat")
	if res.StatusCode != 201 {
		t.Fatalf("import: %d %v", res.StatusCode, lines)
	}
	final := lines[len(lines)-1]
	pack := final["pack"].(map[string]any)
	if pack["name"] != "Denni" || pack["owner_user_id"] == nil {
		t.Errorf("pack: %v", pack)
	}
	if final["imported"] != float64(3) || final["failed"] != float64(1) || final["total"] != float64(4) {
		t.Errorf("counts: %v", final)
	}
	seenFetch, seenStore := false, false
	for _, l := range lines {
		if l["phase"] == "fetch" {
			seenFetch = true
		}
		if l["phase"] == "store" {
			seenStore = true
		}
	}
	if !seenFetch || !seenStore {
		t.Errorf("progress lines: want fetch and store phases, got %d lines", len(lines))
	}
	stickers := pack["stickers"].([]any)
	if len(stickers) != 3 {
		t.Fatalf("stickers: %d", len(stickers))
	}
	got := map[string]string{}
	for _, s := range stickers {
		m := s.(map[string]any)
		got[m["name"].(string)] = m["format"].(string)
	}
	if got["🥳"] != "png" || got["😎"] != "tgs" || got["Sticker 3"] != "webm" {
		t.Errorf("formats/names: %v", got)
	}
	if pack["cover_sticker_id"] == nil {
		t.Error("cover: first sticker should be the cover")
	}
	// the pack is on the caller's account and visible to them
	if res, _ := do(t, ts, "GET", "/api/v1/stickers/packs/"+pack["id"].(string), tokA, nil); res.StatusCode != 200 {
		t.Errorf("pack fetch: %d", res.StatusCode)
	}
}

// postImport runs an import and returns every newline-delimited line of the
// answer, so the test sees the same progress the client does.
func postImport(t *testing.T, ts *httptest.Server, token, url string) (*http.Response, []map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/stickers/packs/import/telegram", strings.NewReader(`{"url":`+strconv.Quote(url)+`}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != 201 {
		return res, nil
	}
	var lines []map[string]any
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("line %q: %v", line, err)
		}
		lines = append(lines, m)
	}
	if len(lines) == 0 || lines[len(lines)-1]["done"] != true {
		t.Fatalf("stream ends without the pack: %q", raw)
	}
	return res, lines
}
