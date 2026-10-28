package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCleanNameStyle(t *testing.T) {
	cases := []struct {
		in, out string
		bad     bool
	}{
		{`null`, ``, false},
		{`{"effect":"gradient","colors":[1,2],"animated":true}`, `{"animated":true,"effect":"gradient","colors":[1,2]}`, false},
		{`{"effect":"aurora","colors":[1,2],"animated":false}`, `{"animated":false,"effect":"aurora","colors":[1,2]}`, false},
		{`{"effect":"gradient","colors":[1,2],"animated":"yes"}`, ``, true},
		{`{"effect":"solid","colors":[]}`, ``, false},
		{`{"font":"bungee","effect":"gradient","colors":[16711680,255]}`, `{"font":"bungee","effect":"gradient","colors":[16711680,255]}`, false},
		{`{"effect":"solid","colors":[65280]}`, `{"effect":"solid","colors":[65280]}`, false},
		{`{"font":"papyrus","effect":"solid","colors":[]}`, ``, true},
		{`{"effect":"sparkle","colors":[1]}`, ``, true},
		{`{"effect":"gradient","colors":[1]}`, ``, true},
		{`{"effect":"aurora","colors":[1,2,3,4,5,6]}`, ``, true},
		{`{"effect":"glow","colors":[16777216]}`, ``, true},
	}
	for _, c := range cases {
		out, problem := cleanNameStyle(json.RawMessage(c.in))
		if (problem != "") != c.bad || out != c.out {
			t.Errorf("%s: got %q %q", c.in, out, problem)
		}
	}
}

func TestNameStyleOnProfile(t *testing.T) {
	_, ts := newTestServer(t)
	tok, id := register(t, ts, "alice")
	style := map[string]any{"animated": false, "font": "pacifico", "effect": "aurora", "colors": []int{0xff0000, 0x00ff00, 0x0000ff}}
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"name_style": style}); res.StatusCode != http.StatusOK {
		t.Fatalf("patch: %d %v", res.StatusCode, body)
	}
	_, body := do(t, ts, "GET", "/api/v1/users/"+id, tok, nil)
	ns, _ := body["name_style"].(map[string]any)
	if ns == nil || ns["font"] != "pacifico" || ns["animated"] != false || len(ns["colors"].([]any)) != 3 {
		t.Fatalf("profile: %v", body)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"name_style": map[string]any{"effect": "nope"}}); res.StatusCode != http.StatusBadRequest || errCode(body) != "invalid_name_style" {
		t.Fatalf("bad effect: %d", res.StatusCode)
	}
	do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"name_style": nil})
	if _, body = do(t, ts, "GET", "/api/v1/users/"+id, tok, nil); body["name_style"] != nil {
		t.Fatalf("cleared: %v", body)
	}
}
