package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"evilion.xyz/chat/internal/games"
	"evilion.xyz/chat/internal/ids"
)

func TestWidgetsAreCheckedSavedAndShown(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, _ := register(t, ts, "bob")
	put := func(widgets any) (*http.Response, map[string]any) {
		return do(t, ts, "PUT", "/api/v1/users/@me/widgets", alice, map[string]any{"widgets": widgets})
	}
	for name, bad := range map[string]any{
		"two favourites": []any{
			map[string]any{"type": "favorite", "games": []any{map[string]any{"name": "Stardew Valley"}}},
			map[string]any{"type": "favorite", "games": []any{map[string]any{"name": "Celeste"}}},
		},
		"favourite of two":   []any{map[string]any{"type": "favorite", "games": []any{map[string]any{"name": "A"}, map[string]any{"name": "B"}}}},
		"nameless game":      []any{map[string]any{"type": "played", "games": []any{map[string]any{"name": " "}}}},
		"card with no title": []any{map[string]any{"type": "custom", "text": "hi"}},
		"bare card":          []any{map[string]any{"type": "custom", "title": "Just a title"}},
		"script link":        []any{map[string]any{"type": "custom", "title": "Link", "link": map[string]any{"url": "javascript:alert(1)"}}},
		"half a stat":        []any{map[string]any{"type": "custom", "title": "Stats", "stats": []any{map[string]any{"label": "Rank", "value": ""}}}},
		"unknown kind":       []any{map[string]any{"type": "poll"}},
		"too many tags":      []any{map[string]any{"type": "playing", "games": []any{map[string]any{"name": "A", "tags": []string{"a", "b", "c", "d"}}}}},
		"missing picture":    []any{map[string]any{"type": "custom", "title": "Pic", "image": "123456789"}},
	} {
		if res, body := put(bad); res.StatusCode != 400 || errCode(body) != "invalid_widgets" {
			t.Errorf("%s: %d %v", name, res.StatusCode, body)
		}
	}
	// a card's picture, cut on the server
	still, err := os.ReadFile("../media/testdata/crop/still.png")
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/users/@me/widgets/image?shape=wide", bytes.NewReader(still))
	req.Header.Set("Authorization", "Bearer "+alice)
	req.Header.Set("Content-Type", "image/png")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var pic map[string]any
	_ = json.Unmarshal(raw, &pic)
	picID, _ := pic["id"].(string)
	if res.StatusCode != 200 || picID == "" || pic["shape"] != "wide" {
		t.Fatalf("picture: %d %s", res.StatusCode, raw)
	}
	good := []any{
		map[string]any{"id": "fav1", "type": "favorite", "games": []any{map[string]any{"name": "Stardew Valley"}}, "note": "Cosy farming forever."},
		map[string]any{"id": "play1", "type": "playing", "games": []any{map[string]any{"name": "Celeste", "tags": []string{"Speedrun", " "}}}},
		map[string]any{"id": "card1", "type": "custom", "title": "My Setup", "image": picID, "shape": "wide", "text": "Mechanical keyboard, two screens.", "stats": []any{map[string]any{"label": "Keys", "value": "87"}}, "link": map[string]any{"url": "https://example.com/setup", "label": "More"}},
	}
	res, body := put(good)
	if res.StatusCode != 200 {
		t.Fatalf("save: %d %v", res.StatusCode, body)
	}
	list, _ := body["widgets"].([]any)
	if len(list) != 3 {
		t.Fatalf("saved: %v", body)
	}
	if tags := list[1].(map[string]any)["games"].([]any)[0].(map[string]any)["tags"].([]any); len(tags) != 1 {
		t.Errorf("an empty tag was kept: %v", tags)
	}
	// the picture is held while a card names it
	if b, _ := srv.Store.BlobByID(context.Background(), parsedID(t, picID)); b.RefCount != 1 {
		t.Errorf("picture refs after saving: %d", b.RefCount)
	}
	// anyone opening the profile sees them, and so does a visitor following its link
	_, prof := do(t, ts, "GET", "/api/v1/users/"+aliceID+"/profile", bob, nil)
	if w, _ := prof["widgets"].([]any); len(w) != 3 || w[2].(map[string]any)["title"] != "My Setup" {
		t.Errorf("profile widgets: %v", prof["widgets"])
	}
	_, shared := do(t, ts, "GET", "/api/v1/profiles/alice", "", nil)
	if w, _ := shared["widgets"].([]any); len(w) != 3 || shared["username"] != "alice" {
		t.Errorf("shared profile: %v", shared)
	}
	// taking the card out lets its picture go
	if res, body := put(good[:2]); res.StatusCode != 200 {
		t.Fatalf("save fewer: %d %v", res.StatusCode, body)
	}
	if b, _ := srv.Store.BlobByID(context.Background(), parsedID(t, picID)); b.RefCount != 0 {
		t.Errorf("picture refs after taking it out: %d", b.RefCount)
	}
	// none at all is an empty list
	if res, body := put(nil); res.StatusCode != 200 || len(body["widgets"].([]any)) != 0 {
		t.Errorf("clear: %d %v", res.StatusCode, body)
	}
}

func TestGameSearchWithoutAList(t *testing.T) {
	_, ts := newTestServer(t)
	alice, _ := register(t, ts, "alice")
	res, body := do(t, ts, "GET", "/api/v1/games/search?q=stardew", alice, nil)
	if res.StatusCode != 200 || body["ready"] != false || len(body["games"].([]any)) != 0 {
		t.Errorf("search: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/media/game/co1wyy?size=l", "", nil); res.StatusCode != 404 {
		t.Errorf("cover without IGDB: %d", res.StatusCode)
	}
	if !strings.Contains(ts.URL, "127.0.0.1") {
		t.Log(ts.URL)
	}
}

func parsedID(t *testing.T, s string) ids.ID {
	t.Helper()
	id, err := ids.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// With IGDB set up, a search goes through this server, and a game saved from
// it is named and drawn as IGDB has it, whatever the app sent.
func TestWidgetsTakeGamesFromIGDB(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, _ := register(t, ts, "alice")
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"access_token":"tok","expires_in":5000000}`)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `[{"id":17000,"name":"Stardew Valley","cover":{"image_id":"xrpmydnu9rpxvxfjkiu7"}}]`)
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()
	srv.Games = games.New("id", "secret", t.TempDir())
	srv.Games.API, srv.Games.Auth = fake.URL+"/v4", fake.URL+"/oauth2/token"
	res, body := do(t, ts, "GET", "/api/v1/games/search?q=stardew", alice, nil)
	found, _ := body["games"].([]any)
	if res.StatusCode != 200 || body["ready"] != true || len(found) != 1 || found[0].(map[string]any)["cover"] != "xrpmydnu9rpxvxfjkiu7" {
		t.Fatalf("search: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PUT", "/api/v1/users/@me/widgets", alice, map[string]any{"widgets": []any{
		map[string]any{"type": "favorite", "games": []any{map[string]any{"id": "17000", "name": "Totally Different", "cover": "badcover1"}}},
	}})
	if res.StatusCode != 200 {
		t.Fatalf("save: %d %v", res.StatusCode, body)
	}
	game := body["widgets"].([]any)[0].(map[string]any)["games"].([]any)[0].(map[string]any)
	if game["name"] != "Stardew Valley" || game["cover"] != "xrpmydnu9rpxvxfjkiu7" {
		t.Errorf("saved game: %v", game)
	}
}
