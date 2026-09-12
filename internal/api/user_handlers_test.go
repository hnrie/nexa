package api

import (
	"strings"
	"testing"
)

func TestProfilePatchAndSettings(t *testing.T) {
	_, ts := newTestServer(t)
	tok, id := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"display_name": "  Alice  ", "about_me": strings.Repeat("long ", 2000), "pronouns": "she/her", "accent_color": 0xff00ff, "status_text": "hi", "presence_pref": "dnd", "dm_privacy": "friends"})
	if res.StatusCode != 200 || body["display_name"] != "Alice" || body["accent_color"].(float64) != 0xff00ff || body["presence_pref"] != "dnd" || body["dm_privacy"] != "friends" || len(body["about_me"].(string)) < 9000 {
		t.Fatalf("patch: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"accent_color": nil, "status_text": nil})
	if res.StatusCode != 200 || body["accent_color"] != nil || body["status_text"] != "" {
		t.Errorf("clear with null: %d %v", res.StatusCode, body)
	}
	for _, bad := range []map[string]any{{"username": "BAD NAME"}, {"display_name": ""}, {"accent_color": 99999999}, {"presence_pref": "away"}, {"dm_privacy": "x"}, {"pronouns": strings.Repeat("p", 41)}} {
		if res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, bad); res.StatusCode != 400 {
			t.Errorf("bad patch %v: %d %v", bad, res.StatusCode, body)
		}
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"username": "bob"}); res.StatusCode != 409 {
		t.Errorf("rename to taken: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"username": "Alice2"}); res.StatusCode != 200 || body["username"] != "alice2" {
		t.Errorf("rename: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/"+id, tokB, nil)
	if res.StatusCode != 200 || body["username"] != "alice2" || body["dm_privacy"] != nil || body["flags"].(float64) != 1 {
		t.Errorf("public view: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/"+idB+"/profile", tok, nil)
	if res.StatusCode != 200 || body["user"].(map[string]any)["username"] != "bob" || len(body["mutual_friends"].([]any)) != 0 {
		t.Errorf("profile: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/"+idB+"/public-key", tok, nil)
	if res.StatusCode != 200 || body["public_key"] != b64(pub32) {
		t.Errorf("public key: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "GET", "/api/v1/users/12345", tok, nil); res.StatusCode != 404 {
		t.Error("unknown user 404")
	}
	res, body = do(t, ts, "GET", "/api/v1/users/search?q=al", tokB, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 1 {
		t.Errorf("search: %d %v", res.StatusCode, body)
	}
	// settings
	if res, _ = do(t, ts, "GET", "/api/v1/users/@me/settings", tok, nil); res.StatusCode != 204 {
		t.Errorf("no settings yet: %d", res.StatusCode)
	}
	res, body = do(t, ts, "PUT", "/api/v1/users/@me/settings", tok, map[string]any{"blob": b64([]byte("enc1")), "version": 0})
	if res.StatusCode != 200 || body["version"].(float64) != 1 {
		t.Fatalf("put settings: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/users/@me/settings", tok, map[string]any{"blob": b64([]byte("enc2")), "version": 0}); res.StatusCode != 409 || errCode(body) != "settings_conflict" {
		t.Errorf("conflict: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/settings", tok, nil)
	if res.StatusCode != 200 || body["blob"] != b64([]byte("enc1")) || body["version"].(float64) != 1 {
		t.Errorf("get settings: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/keys", tok, nil)
	if res.StatusCode != 200 || body["enc_private_key"] != b64(wrapped) {
		t.Errorf("keys: %d %v", res.StatusCode, body)
	}
	// delete account
	if res, _ = do(t, ts, "POST", "/api/v1/users/@me/delete", tokB, map[string]any{"auth_key": b64(key32b)}); res.StatusCode != 401 {
		t.Error("delete with wrong password")
	}
	if res, _ = do(t, ts, "POST", "/api/v1/users/@me/delete", tokB, map[string]any{"auth_key": b64(key32)}); res.StatusCode != 204 {
		t.Error("delete")
	}
	res, body = do(t, ts, "GET", "/api/v1/users/"+idB, tok, nil)
	if res.StatusCode != 200 || body["display_name"] != "Deleted User" {
		t.Errorf("deleted user view: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "POST", "/api/v1/auth/login", "", map[string]any{"username": "bob", "auth_key": b64(key32)}); res.StatusCode != 401 {
		t.Error("deleted user cannot log in")
	}
}
