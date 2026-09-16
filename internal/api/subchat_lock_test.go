package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// A password on a subchat keeps its messages shut until this session types it,
// and taking it off lets everyone back in.
func TestSubchatPasswordGatesReading(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	if res.StatusCode != 201 {
		t.Fatalf("create dm: %d %v", res.StatusCode, body)
	}
	dm := body["id"].(string)

	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	salt := make([]byte, 16)
	params := json.RawMessage(`{"m":65536,"t":3,"p":1,"v":1}`)

	res, body = do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", tokA, map[string]any{
		"name": "quiet", "password_key": b64(key), "password_salt": b64(salt), "password_params": params,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create subchat: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)
	if body["locked"] != true {
		t.Fatalf("the subchat should say it is locked: %v", body)
	}

	msgs := "/api/v1/channels/" + sub + "/messages"
	// alice set the password, so her own session is already through
	if res, body = do(t, ts, "GET", msgs, tokA, nil); res.StatusCode != http.StatusOK {
		t.Errorf("whoever set the password should not have to type it: %d %v", res.StatusCode, body)
	}
	// bob is in the subchat but has not typed it
	if res, body = do(t, ts, "GET", msgs, tokB, nil); res.StatusCode != http.StatusForbidden || errCode(body) != "locked" {
		t.Fatalf("locked read: %d %v", res.StatusCode, body)
	}
	// he is told how to stretch it, and nothing about the password itself
	res, body = do(t, ts, "GET", "/api/v1/channels/"+sub+"/lock", tokB, nil)
	if res.StatusCode != http.StatusOK || body["locked"] != true {
		t.Fatalf("lock params: %d %v", res.StatusCode, body)
	}
	if _, ok := body["salt"].(string); !ok {
		t.Fatalf("no salt to stretch with: %v", body)
	}
	raw, _ := json.Marshal(body)
	if strings.Contains(string(raw), "argon2") || strings.Contains(string(raw), "hash") {
		t.Errorf("the stored hash must not be handed out: %s", raw)
	}
	// the wrong password gets him nowhere
	wrong := make([]byte, 32)
	if res, body = do(t, ts, "POST", "/api/v1/channels/"+sub+"/unlock", tokB, map[string]any{"password_key": b64(wrong)}); res.StatusCode != http.StatusForbidden {
		t.Errorf("wrong password: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "POST", "/api/v1/channels/"+sub+"/unlock", tokB, map[string]any{"password_key": b64(key)}); res.StatusCode != http.StatusOK {
		t.Fatalf("unlock: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "GET", msgs, tokB, nil); res.StatusCode != http.StatusOK {
		t.Errorf("after the password, reading should work: %d %v", res.StatusCode, body)
	}

	// changing the password shuts everyone else out again
	key2 := make([]byte, 32)
	for i := range key2 {
		key2[i] = byte(200 - i)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+sub, tokA, map[string]any{"password_key": b64(key2), "password_salt": b64(salt), "password_params": params}); res.StatusCode != http.StatusOK {
		t.Fatalf("change: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "GET", msgs, tokB, nil); res.StatusCode != http.StatusForbidden {
		t.Errorf("a new password should be asked for again: %d", res.StatusCode)
	}
	// renaming still works for the session that set it
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+sub, tokA, map[string]any{"name": "quieter"}); res.StatusCode != http.StatusOK || body["name"] != "quieter" {
		t.Errorf("rename: %d %v", res.StatusCode, body)
	}
	// and taking the password off lets him straight back in
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+sub, tokA, map[string]any{"password_remove": true}); res.StatusCode != http.StatusOK {
		t.Fatalf("remove: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "GET", msgs, tokB, nil); res.StatusCode != http.StatusOK {
		t.Errorf("with no password there is nothing to type: %d %v", res.StatusCode, body)
	}
}
