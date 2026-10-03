package games

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeIGDB answers as Twitch's token endpoint, IGDB's games endpoint and its
// picture server do, and counts what it was asked.
type fakeIGDB struct {
	ts                     *httptest.Server
	tokens, queries, cover atomic.Int32
	lastBody               atomic.Value
	expireFirst            bool
}

func newFake(t *testing.T) *fakeIGDB {
	f := &fakeIGDB{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("client_id") != "id" || r.URL.Query().Get("client_secret") != "secret" || r.URL.Query().Get("grant_type") != "client_credentials" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		n := f.tokens.Add(1)
		_, _ = io.WriteString(w, `{"access_token":"tok`+string(rune('0'+n))+`","expires_in":5000000,"token_type":"bearer"}`)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, r *http.Request) {
		f.queries.Add(1)
		body, _ := io.ReadAll(r.Body)
		f.lastBody.Store(string(body))
		if r.Header.Get("Client-ID") != "id" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer tok") {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		if f.expireFirst && r.Header.Get("Authorization") == "Bearer tok1" {
			http.Error(w, "expired", http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `[{"id":17000,"name":"Stardew Valley","cover":{"id":1,"image_id":"xrpmydnu9rpxvxfjkiu7"},"first_release_date":1456444800},{"id":1942,"name":"The Witcher 3: Wild Hunt","cover":{"id":2,"image_id":"co1wyy"}},{"id":5,"name":"No Cover"}]`)
	})
	mux.HandleFunc("GET /igdb/image/upload/{size}/{file}", func(w http.ResponseWriter, r *http.Request) {
		f.cover.Add(1)
		if r.PathValue("file") != "co1wyy.jpg" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("\xff\xd8\xff\xe0 a jpeg, near enough"))
	})
	f.ts = httptest.NewServer(mux)
	t.Cleanup(f.ts.Close)
	return f
}

func (f *fakeIGDB) client(t *testing.T) *Client {
	c := New("id", "secret", t.TempDir())
	c.API = f.ts.URL + "/v4"
	c.Auth = f.ts.URL + "/oauth2/token"
	c.Images = f.ts.URL + "/igdb/image/upload"
	return c
}

func TestSearchAsksIGDBOnceAndKeepsTheAnswer(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	got, err := c.Search(ctx, `  stardew  "valley";`, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Name != "Stardew Valley" || got[0].Cover != "xrpmydnu9rpxvxfjkiu7" || got[0].Year != 2016 || got[2].Cover != "" {
		t.Fatalf("results: %+v", got)
	}
	// what was typed cannot break out of the query it is put in
	if body := f.lastBody.Load().(string); !strings.HasPrefix(body, `search "stardew valley ";`) {
		t.Errorf("query: %s", body)
	}
	if _, err := c.Search(ctx, "STARDEW \"valley\";", 2); err != nil || f.queries.Load() != 1 {
		t.Errorf("asked again: %v %d", err, f.queries.Load())
	}
	// a game a search brought is known without asking
	known, err := c.Lookup(ctx, []string{"1942"})
	if err != nil || known["1942"].Name != "The Witcher 3: Wild Hunt" || f.queries.Load() != 1 {
		t.Errorf("lookup: %v %v %d", err, known, f.queries.Load())
	}
}

func TestATokenRefusedIsFetchedAgain(t *testing.T) {
	f := newFake(t)
	f.expireFirst = true
	c := f.client(t)
	if _, err := c.Search(context.Background(), "witcher", 5); err != nil {
		t.Fatal(err)
	}
	if f.tokens.Load() != 2 {
		t.Errorf("tokens fetched: %d", f.tokens.Load())
	}
}

func TestOffWithoutCredentials(t *testing.T) {
	c := New("", "", t.TempDir())
	if c.On() {
		t.Fatal("on without credentials")
	}
	if _, err := c.Search(context.Background(), "x", 5); err != ErrOff {
		t.Errorf("search: %v", err)
	}
}

func TestCoversAreFetchedOnceAndOnlyFromIGDB(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	p, err := c.CoverFile(ctx, "co1wyy", "l")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CoverFile(ctx, "co1wyy", "l"); err != nil || f.cover.Load() != 1 {
		t.Errorf("fetched again: %v %d", err, f.cover.Load())
	}
	if _, err := c.CoverFile(ctx, "../../etc", "l"); err != ErrUnknown {
		t.Errorf("odd id: %v", err)
	}
	if _, err := c.CoverFile(ctx, "co1wyy", "huge"); err != ErrUnknown {
		t.Errorf("odd size: %v", err)
	}
	if _, err := c.CoverFile(ctx, "nosuchcover", "s"); err != ErrUnknown {
		t.Errorf("missing cover: %v", err)
	}
}
