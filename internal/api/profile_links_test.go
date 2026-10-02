package api

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A profile link shows the person to anyone, signed in or not, and nothing of
// theirs that is not already on their profile for everyone else to see.
func TestSharedProfile(t *testing.T) {
	srv, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "maya")
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{
		"display_name": "Maya", "about_me": "illustrator, night owl", "pronouns": "she/her",
		"accent_color": 0xff7a00, "status_text": "out at the lake",
	}); res.StatusCode != 200 {
		t.Fatalf("profile: %d %v", res.StatusCode, body)
	}

	res, body := do(t, ts, "GET", "/api/v1/profiles/maya", "", nil)
	if res.StatusCode != 200 || body["id"] != id || body["display_name"] != "Maya" || body["about_me"] != "illustrator, night owl" || body["pronouns"] != "she/her" {
		t.Fatalf("shared profile: %d %v", res.StatusCode, body)
	}
	// where they are right now and their key stay with the signed-in app
	if body["status_text"] != "" || body["public_key"] != nil {
		t.Errorf("the shared profile carries status or key: %v", body)
	}
	// a link typed with capitals still finds them
	if res, body := do(t, ts, "GET", "/api/v1/profiles/MAYA", "", nil); res.StatusCode != 200 || body["id"] != id {
		t.Errorf("capitals: %d %v", res.StatusCode, body)
	}
	for _, name := range []string{"nobody", "x", "no%20spaces"} {
		if res, body := do(t, ts, "GET", "/api/v1/profiles/"+name, "", nil); res.StatusCode != 404 || errCode(body) != "profile_not_found" {
			t.Errorf("%s: %d %v", name, res.StatusCode, body)
		}
	}
	// Nexa's own account is not a person with a profile to share
	sys, err := srv.systemUser(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/profiles/"+sys.Username, "", nil); res.StatusCode != 404 {
		t.Errorf("the system account has a shared profile: %d", res.StatusCode)
	}
	// and a banned account's link leads nowhere
	mustAct(t, ts, modTok, id, map[string]any{"action": "ban", "reason": "spam", "permanent": true})
	if res, _ := do(t, ts, "GET", "/api/v1/profiles/maya", "", nil); res.StatusCode != 404 {
		t.Errorf("a banned account is still shared: %d", res.StatusCode)
	}
}

// Pasted anywhere else, a profile link unfurls to the person: their name,
// their about me as a line of plain text, their picture and their colour,
// and it asks search engines to leave it out.
func TestProfileLinkPreview(t *testing.T) {
	srv, _ := newTestServer(t)
	dist := t.TempDir()
	os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><head><meta name=\"theme-color\" content=\"#1c1825\" />\n<title>Nexa</title></head><body><div id=\"root\"></div></body></html>"), 0o644)
	srv.Cfg.WebDist = dist
	srv.Cfg.PublicURL = "https://chat.example.org"
	ts := newHTTPTestServer(t, srv)
	tok, _ := register(t, ts, "maya")
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{
		"display_name": "Maya", "about_me": "**illustrator** & night owl ||the lake house||\n<:wave:123456789012345678> say hi <@123456789012345678>",
		"accent_color": 0x00a0ff,
	}); res.StatusCode != 200 {
		t.Fatalf("profile: %d %v", res.StatusCode, body)
	}
	get := func(path string) (*http.Response, string) {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res, string(b)
	}
	res, body := get("/@maya")
	for _, want := range []string{
		`<meta property="og:title" content="Maya (@maya)">`,
		`<meta property="og:description" content="illustrator &amp; night owl :wave: say hi">`,
		`<meta property="og:url" content="https://chat.example.org/@maya">`,
		`<meta property="og:image" content="https://chat.example.org/icons/icon-512.png">`,
		`<meta name="robots" content="noindex">`,
		`<meta name="theme-color" content="#00a0ff" />`,
		`<div id="root">`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("profile page lacks %s: %q", want, body)
		}
	}
	if res.StatusCode != 200 || res.Header.Get("X-Robots-Tag") != "noindex" || !strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("profile page: %d %v", res.StatusCode, res.Header)
	}
	// nothing hidden in a spoiler, and the house style: no em dashes
	if strings.Contains(body, "lake house") || strings.Contains(body, "—") {
		t.Errorf("profile page says too much: %q", body)
	}
	// a link to nobody is the app's own page, which says so
	if res, body := get("/@nobody"); res.StatusCode != 200 || strings.Contains(body, "og:title") || !strings.Contains(body, `<div id="root">`) {
		t.Errorf("missing profile page: %d %q", res.StatusCode, body)
	}
}

// In a chat a profile link is answered from our own records, at any of our
// addresses, so the reader's app can draw the person's card.
func TestUnfurlProfileLink(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.PublicURL = "https://chat.example.org"
	tok, _ := register(t, ts, "maya")
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"display_name": "Maya", "about_me": "night owl"}); res.StatusCode != 200 {
		t.Fatalf("profile: %d %v", res.StatusCode, body)
	}
	for _, link := range []string{"https://chat.example.org/@maya", "https://CHAT.example.org/@Maya/"} {
		res, body := do(t, ts, "GET", "/api/v1/unfurl?url="+url.QueryEscape(link), tok, nil)
		if res.StatusCode != 200 || body["type"] != "profile" || body["username"] != "maya" || body["title"] != "Maya (@maya)" || body["description"] != "night owl" {
			t.Errorf("%s: %d %v", link, res.StatusCode, body)
		}
	}
	// someone else's site with an @ path is just a link
	if got := srv.profileLinkName("https://elsewhere.example/@maya"); got != "" {
		t.Errorf("another site's link read as ours: %q", got)
	}
}

func TestAboutLine(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"plain words", "plain words"},
		{"# Heading\n> quoted\n-# small", "Heading quoted small"},
		{"a ||hidden|| b", "a b"},
		{"<a:dance:1> <#2> <@&3> <@!4>", ":dance:"},
		{"snake_case and __bold__ and ~~gone~~ `code`", "snake_case and bold and gone code"},
		{strings.Repeat("word ", 60), strings.Repeat("word ", 39) + "word…"},
	}
	for _, c := range cases {
		if got := aboutLine(c.in, 200); got != c.want {
			t.Errorf("aboutLine(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
