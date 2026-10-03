package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func uploadTypingImage(t *testing.T, ts *httptest.Server, tok string, body []byte) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/users/@me/typing/image", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "image/png")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// A typing style can hold pictures of one's own, cut square on the server
// (a moving one stays moving), each held for as long as the style names it.
func TestTypingStylePictures(t *testing.T) {
	srv, ts := newTestServer(t)
	tok, id := register(t, ts, "alice")
	still, err := os.ReadFile("../media/testdata/crop/still.png")
	if err != nil {
		t.Fatal(err)
	}
	anim, err := os.ReadFile("../media/testdata/crop/anim.gif")
	if err != nil {
		t.Fatal(err)
	}
	code, pic := uploadTypingImage(t, ts, tok, still)
	if code != 200 {
		t.Fatalf("upload: %d %v", code, pic)
	}
	picID := pic["id"].(string)
	code, moving := uploadTypingImage(t, ts, tok, anim)
	if code != 200 || moving["animated"] != true {
		t.Fatalf("moving upload: %d %v", code, moving)
	}
	movingID := moving["id"].(string)
	// anyone can see it, as small as it is kept
	if res, _ := do(t, ts, "GET", "/media/typing/"+picID, "", nil); res.StatusCode != 200 {
		t.Errorf("serve: %d", res.StatusCode)
	}
	style := map[string]any{"emoji": []string{"img:" + picID, "🐸", "img:" + movingID}, "motion": "wave", "preset": "cooking"}
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": style}); res.StatusCode != 200 {
		t.Fatalf("save: %d %v", res.StatusCode, body)
	}
	refs := func(blob string) int {
		b, err := srv.Store.BlobByID(context.Background(), parsedID(t, blob))
		if err != nil {
			t.Fatal(err)
		}
		return b.RefCount
	}
	if refs(picID) != 1 || refs(movingID) != 1 {
		t.Errorf("refs after saving: %d %d", refs(picID), refs(movingID))
	}
	// saving it again holds nothing twice
	if res, _ := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": style}); res.StatusCode != 200 || refs(picID) != 1 {
		t.Errorf("saved again: %d refs %d", res.StatusCode, refs(picID))
	}
	// one picture swapped for an emoji lets it go and keeps the other
	style["emoji"] = []string{"🔥", "🐸", "img:" + movingID}
	if res, _ := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": style}); res.StatusCode != 200 {
		t.Fatal("swap")
	}
	if refs(picID) != 0 || refs(movingID) != 1 {
		t.Errorf("refs after the swap: %d %d", refs(picID), refs(movingID))
	}
	// a picture that is not there, or is not a typing picture, is refused
	for _, bad := range []string{"img:123456789", "img:" + mustWidgetPicture(t, ts, tok)} {
		res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": map[string]any{"emoji": []string{bad}, "motion": "wave"}})
		if res.StatusCode != 400 || errCode(body) != "invalid_typing_style" {
			t.Errorf("%s: %d %v", bad, res.StatusCode, body)
		}
	}
	// the style everyone sees names it
	_, u := do(t, ts, "GET", "/api/v1/users/"+id, tok, nil)
	if got, _ := json.Marshal(u["typing_style"]); !bytes.Contains(got, []byte("img:"+movingID)) {
		t.Errorf("public style: %s", got)
	}
	// back to the plain style: every picture goes
	if res, _ := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": nil}); res.StatusCode != 200 || refs(movingID) != 0 {
		t.Errorf("cleared: %d refs %d", res.StatusCode, refs(movingID))
	}
}

func mustWidgetPicture(t *testing.T, ts *httptest.Server, tok string) string {
	t.Helper()
	still, _ := os.ReadFile("../media/testdata/crop/still.png")
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/users/@me/widgets/image?shape=square", bytes.NewReader(still))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "image/png")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out["id"].(string)
}
