package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCleanTypingStyle(t *testing.T) {
	ok := []struct{ in, want string }{
		{`null`, ``},
		{`{"emoji":["🐸","🔥","✨"],"motion":"pulse","preset":"yapping"}`, `{"emoji":["🐸","🔥","✨"],"motion":"pulse","preset":"yapping"}`},
		// no motion asked for waves; own words win over a preset
		{`{"emoji":["<a:party:123456789012345678>"],"preset":"cooking","words":"  is cooking up a storm "}`, `{"emoji":["<a:party:123456789012345678>"],"motion":"wave","words":"is cooking up a storm"}`},
		{`{"emoji":["👩‍💻"],"motion":"still"}`, `{"emoji":["👩‍💻"],"motion":"still"}`},
		// nothing chosen is the plain style
		{`{"emoji":[],"motion":"wiggle"}`, ``},
	}
	for _, c := range ok {
		got, problem := cleanTypingStyle(json.RawMessage(c.in))
		if problem != "" || got != c.want {
			t.Errorf("%s: got %q (%s), want %q", c.in, got, problem, c.want)
		}
	}
	bad := []string{
		`"wave"`,
		`{"emoji":["🐸","🔥","✨","🎉"]}`,
		`{"emoji":["hi"]}`,
		`{"emoji":["🐸🔥"]}`,
		`{"emoji":["<:x:12>"],"motion":"spin"}`,
		`{"preset":"barking"}`,
		`{"words":"` + strings.Repeat("a", maxTypingWords+1) + `"}`,
	}
	for _, in := range bad {
		if got, problem := cleanTypingStyle(json.RawMessage(in)); problem == "" {
			t.Errorf("%s: accepted as %q", in, got)
		}
	}
}

func TestTypingStyleIsPartOfTheProfile(t *testing.T) {
	_, ts := newTestServer(t)
	tok, id := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	style := map[string]any{"emoji": []string{"🐸", "✨"}, "motion": "wiggle", "preset": "plotting"}
	res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": style})
	if res.StatusCode != 200 {
		t.Fatalf("patch: %d %v", res.StatusCode, body)
	}
	got, _ := body["typing_style"].(map[string]any)
	if got["preset"] != "plotting" || got["motion"] != "wiggle" || len(got["emoji"].([]any)) != 2 {
		t.Errorf("own view: %v", body["typing_style"])
	}
	// everyone else sees it, and the account's own connection starts with it
	_, other := do(t, ts, "GET", "/api/v1/users/"+id, tokB, nil)
	if s, _ := other["typing_style"].(map[string]any); s["preset"] != "plotting" {
		t.Errorf("public view: %v", other["typing_style"])
	}
	g := connectGWReady(t, ts, tok)
	if s, _ := g.ready["user"].(map[string]any)["typing_style"].(map[string]any); s["motion"] != "wiggle" {
		t.Errorf("ready: %v", g.ready["user"])
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": map[string]any{"emoji": []string{"abc"}}}); res.StatusCode != 400 || errCode(body) != "invalid_typing_style" {
		t.Errorf("bad style: %d %v", res.StatusCode, body)
	}
	// null takes it off, and it says so rather than leaving the field out
	res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": nil})
	if v, present := body["typing_style"]; res.StatusCode != 200 || !present || v != nil {
		t.Errorf("clear: %d %v", res.StatusCode, body)
	}
}
