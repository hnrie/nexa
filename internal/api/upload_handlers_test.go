package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func jsonUnmarshal(b []byte, v any) error  { return json.Unmarshal(b, v) }
func parseID(s string) (ids.ID, error)     { return ids.Parse(s) }
func osStat(p string) (os.FileInfo, error) { return os.Stat(p) }

// sendChunk pushes one piece of a resumable upload.
func sendChunk(t *testing.T, ts *httptest.Server, token, id string, offset int64, data []byte) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("PATCH", ts.URL+"/api/v1/uploads/"+id, bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Upload-Offset", strconv.FormatInt(offset, 10))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = jsonUnmarshal(raw, &out)
	}
	return res, out
}

func TestResumableUploadInPieces(t *testing.T) {
	srv, ts := newTestServer(t)
	token, _ := register(t, ts, "alice")
	tokenB, _ := register(t, ts, "bob")

	// three pieces, the last one short
	body := bytes.Repeat([]byte("abcdefgh"), 300)
	res, created := do(t, ts, "POST", "/api/v1/uploads", token, map[string]any{"size": len(body)})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, created)
	}
	id := created["id"].(string)
	if created["chunk_size"].(float64) != float64(MaxChunkBytes) {
		t.Errorf("the client needs to know how much fits in one request: %v", created)
	}

	// nobody else can see it, push to it or finish it
	if r, _ := do(t, ts, "GET", "/api/v1/uploads/"+id, tokenB, nil); r.StatusCode != 404 {
		t.Errorf("someone else reading it: %d", r.StatusCode)
	}
	if r, _ := sendChunk(t, ts, tokenB, id, 0, body[:10]); r.StatusCode != 404 {
		t.Errorf("someone else writing to it: %d", r.StatusCode)
	}

	// a piece that does not follow on is refused, and says where to resume
	r, _ := sendChunk(t, ts, token, id, 500, body[500:])
	if r.StatusCode != 409 || r.Header.Get("Upload-Offset") != "0" {
		t.Fatalf("out of order: %d %q", r.StatusCode, r.Header.Get("Upload-Offset"))
	}

	sizes := []int{1000, 1000, len(body) - 2000}
	at := 0
	for _, n := range sizes {
		r, out := sendChunk(t, ts, token, id, int64(at), body[at:at+n])
		if r.StatusCode != 200 {
			t.Fatalf("piece at %d: %d %v", at, r.StatusCode, out)
		}
		at += n
		if out["received"].(float64) != float64(at) {
			t.Fatalf("received after %d: %v", at, out["received"])
		}
	}

	// finishing early is refused before everything lands, but we are done now
	res, fin := do(t, ts, "POST", "/api/v1/uploads/"+id+"/finish", token, nil)
	if res.StatusCode != 201 {
		t.Fatalf("finish: %d %v", res.StatusCode, fin)
	}
	if fin["size"].(float64) != float64(len(body)) {
		t.Errorf("stored size: %v", fin)
	}

	// the bytes come back exactly as they went in
	blobID := fin["blob_id"].(string)
	req, _ := http.NewRequest("GET", ts.URL+"/media/attachments/"+blobID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	got, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer got.Body.Close()
	back, _ := io.ReadAll(got.Body)
	if got.StatusCode != 200 || !bytes.Equal(back, body) {
		t.Fatalf("download: %d, %d bytes back of %d", got.StatusCode, len(back), len(body))
	}

	// the session is gone once it is finished
	if r, _ := do(t, ts, "GET", "/api/v1/uploads/"+id, token, nil); r.StatusCode != 404 {
		t.Errorf("finished session should not linger: %d", r.StatusCode)
	}
	_ = srv
}

func TestUploadRefusesWhatItCannotHold(t *testing.T) {
	srv, ts := newTestServer(t)
	token, _ := register(t, ts, "alice")

	res, body := do(t, ts, "POST", "/api/v1/uploads", token, map[string]any{"size": srv.Cfg.MaxUploadBytes + 1})
	if res.StatusCode != 413 || errCode(body) != "too_large" {
		t.Errorf("over the limit: %d %v", res.StatusCode, body)
	}
	for _, bad := range []int64{0, -5} {
		res, body = do(t, ts, "POST", "/api/v1/uploads", token, map[string]any{"size": bad})
		if res.StatusCode != 413 {
			t.Errorf("size %d: %d %v", bad, res.StatusCode, body)
		}
	}

	// an unfinished transfer cannot be turned into a blob
	_, created := do(t, ts, "POST", "/api/v1/uploads", token, map[string]any{"size": 100})
	id := created["id"].(string)
	sendChunk(t, ts, token, id, 0, bytes.Repeat([]byte("x"), 40))
	res, body = do(t, ts, "POST", "/api/v1/uploads/"+id+"/finish", token, nil)
	if res.StatusCode != 400 || errCode(body) != "incomplete" {
		t.Errorf("finishing early: %d %v", res.StatusCode, body)
	}

	// and cancelling takes the bytes with it
	res, _ = do(t, ts, "DELETE", "/api/v1/uploads/"+id, token, nil)
	if res.StatusCode != 204 {
		t.Fatalf("cancel: %d", res.StatusCode)
	}
	if _, err := srvStat(srv, id); err == nil {
		t.Error("the spooled bytes should be gone")
	}
}

func srvStat(s *Server, id string) (any, error) {
	parsed, err := parseID(id)
	if err != nil {
		return nil, err
	}
	return osStat(s.Media.SpoolPath(parsed))
}

func TestUploadChunkTooBig(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := register(t, ts, "alice")
	_, created := do(t, ts, "POST", "/api/v1/uploads", token, map[string]any{"size": MaxChunkBytes * 2})
	id := created["id"].(string)
	res, body := sendChunk(t, ts, token, id, 0, bytes.Repeat([]byte("y"), MaxChunkBytes+1024))
	if res.StatusCode != 413 {
		t.Errorf("an over-sized piece should be refused: %d %v", res.StatusCode, body)
	}
}
