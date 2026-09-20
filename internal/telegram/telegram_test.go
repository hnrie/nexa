package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseSetName(t *testing.T) {
	ok := map[string]string{
		"https://t.me/addstickers/dennicat":         "dennicat",
		"http://t.me/addstickers/DenniCat":          "DenniCat",
		"https://telegram.me/addstickers/Animals":   "Animals",
		"t.me/addstickers/Animals":                  "Animals",
		"telegram.me/addstickers/a_b9":              "a_b9",
		"https://t.me/addstickers/dennicat/":        "dennicat",
		"https://www.t.me/addstickers/dennicat":     "dennicat",
		"dennicat":                                  "dennicat",
		"  dennicat  ":                              "dennicat",
		"https://t.me/addstickers/dennicat?x=1#y":   "dennicat",
		"https://telegram.dog/addstickers/dennicat": "",
	}
	for in, want := range ok {
		got, err := ParseSetName(in)
		if want == "" {
			if err == nil {
				t.Errorf("ParseSetName(%q) = %q, want error", in, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("ParseSetName(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "https://example.com/addstickers/x", "https://t.me/dennicat", "https://t.me/addstickers/", "https://t.me/addstickers/a-b", "not a name!"} {
		if _, err := ParseSetName(in); err == nil {
			t.Errorf("ParseSetName(%q) succeeded, want error", in)
		}
	}
}

// mockTelegram answers getStickerSet/getFile and serves one file, so the
// client is tested without touching the real API.
func mockTelegram(t *testing.T, fileBytes []byte) *httptest.Server {
	t.Helper()
	var ts *httptest.Server
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		write := func(v any) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": v})
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/getStickerSet"):
			if r.URL.Query().Get("name") != "dennicat" {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "description": "Bad Request: STICKERSET_INVALID"})
				return
			}
			write(map[string]any{
				"name":  "dennicat",
				"title": "Denni",
				"stickers": []any{
					map[string]any{"file_id": "f1", "emoji": "🥳", "width": 512, "height": 512},
					map[string]any{"file_id": "f2", "emoji": "", "width": 512, "height": 512, "is_video": true},
				},
			})
		case strings.HasSuffix(r.URL.Path, "/getFile"):
			write(map[string]any{"file_id": r.URL.Query().Get("file_id"), "file_path": "stickers/f.webp", "file_size": len(fileBytes)})
		case strings.HasPrefix(r.URL.Path, "/file/"):
			w.Write(fileBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

func withMockAPI(t *testing.T, ts *httptest.Server) {
	t.Helper()
	oldAPI, oldFile := APIBase, FileBase
	APIBase = ts.URL
	FileBase = ts.URL + "/file"
	t.Cleanup(func() { APIBase, FileBase = oldAPI, oldFile })
}

func TestClientRoundTrip(t *testing.T) {
	ts := mockTelegram(t, []byte("bytes"))
	withMockAPI(t, ts)
	c := NewClient("test-token")
	ctx := context.Background()
	set, err := c.GetStickerSet(ctx, "dennicat")
	if err != nil {
		t.Fatalf("GetStickerSet: %v", err)
	}
	if set.Title != "Denni" || len(set.Stickers) != 2 || set.Stickers[0].Emoji != "🥳" || !set.Stickers[1].IsVideo {
		t.Fatalf("set: %+v", set)
	}
	if _, err := c.GetStickerSet(ctx, "nope"); err == nil {
		t.Fatal("missing set: want error")
	}
	f, err := c.GetFile(ctx, "f1")
	if err != nil || f.FilePath != "stickers/f.webp" {
		t.Fatalf("GetFile: %+v %v", f, err)
	}
	if got := c.FileURL(f.FilePath); got != ts.URL+"/file/bottest-token/stickers/f.webp" {
		t.Fatalf("FileURL: %s", got)
	}
	body, err := c.DownloadFile(ctx, c.FileURL(f.FilePath), 100)
	if err != nil || string(body) != "bytes" {
		t.Fatalf("DownloadFile: %q %v", body, err)
	}
	if _, err := c.DownloadFile(ctx, c.FileURL(f.FilePath), 2); err == nil {
		t.Fatal("oversize download: want error")
	}
}
