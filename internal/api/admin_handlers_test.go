package api

import (
	"testing"
	"time"
)

func TestAdminAndInstance(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice") // first account is the admin
	tokB, idB := register(t, ts, "bob")
	// public info about Nexa
	res, body := do(t, ts, "GET", "/api/v1/instance", "", nil)
	if res.StatusCode != 200 || body["registration"] != "open" || body["needs_key"] != false {
		t.Fatalf("instance: %d %v", res.StatusCode, body)
	}
	// only admins reach the admin API
	if res, body = do(t, ts, "GET", "/api/v1/admin/stats", tokB, nil); res.StatusCode != 403 || errCode(body) != "admin_only" {
		t.Errorf("non-admin: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/admin/stats", tokA, nil)
	if res.StatusCode != 200 || body["users"].(float64) != 2 {
		t.Errorf("stats: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/admin/users?q=bo", tokA, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 1 || body["_list"].([]any)[0].(map[string]any)["username"] != "bob" {
		t.Errorf("users search: %d %v", res.StatusCode, body)
	}
	// self-protection
	if res, _ = do(t, ts, "PATCH", "/api/v1/admin/users/"+idA, tokA, map[string]any{"admin": false}); res.StatusCode != 400 {
		t.Error("demote self")
	}
	// disabling bob logs him out and blocks logins
	gb := connectGW(t, ts, tokB)
	res, body = do(t, ts, "PATCH", "/api/v1/admin/users/"+idB, tokA, map[string]any{"disabled": true})
	if res.StatusCode != 200 || body["disabled"] != true {
		t.Fatalf("disable: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("session_expired", 3*time.Second); ev == nil {
		t.Error("session_expired for disabled user")
	}
	if res, _ = do(t, ts, "GET", "/api/v1/users/@me", tokB, nil); res.StatusCode != 401 {
		t.Errorf("disabled token still works: %d", res.StatusCode)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/admin/users/"+idB, tokA, map[string]any{"disabled": false, "admin": true}); res.StatusCode != 200 || body["admin"] != true || body["disabled"] != false {
		t.Errorf("re-enable + promote: %d %v", res.StatusCode, body)
	}
	// registration policy can be changed at runtime
	res, body = do(t, ts, "PATCH", "/api/v1/admin/settings", tokA, map[string]any{"registration": "closed"})
	if res.StatusCode != 200 || body["registration"] != "closed" {
		t.Fatalf("settings: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "POST", "/api/v1/auth/register", "", registerBody("carol")); res.StatusCode != 403 || errCode(body) != "registration_closed" {
		t.Errorf("closed registration: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PATCH", "/api/v1/admin/settings", tokA, map[string]any{"registration": "invite", "registration_key": "secret"})
	if res.StatusCode != 200 || body["registration_key_set"] != true {
		t.Fatalf("invite mode: %d %v", res.StatusCode, body)
	}
	_, body = do(t, ts, "GET", "/api/v1/instance", "", nil)
	if body["registration"] != "invite" || body["needs_key"] != true {
		t.Errorf("instance reflects override: %v", body)
	}
	if res, _ = do(t, ts, "POST", "/api/v1/auth/register", "", registerBody("carol")); res.StatusCode != 403 {
		t.Error("invite mode without key")
	}
	withKey := registerBody("carol")
	withKey["registration_key"] = "secret"
	if res, body = do(t, ts, "POST", "/api/v1/auth/register", "", withKey); res.StatusCode != 201 {
		t.Errorf("invite mode with key: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "PATCH", "/api/v1/admin/settings", tokA, map[string]any{"registration": "sideways"}); res.StatusCode != 400 {
		t.Error("bad mode")
	}
	_, _ = do(t, ts, "PATCH", "/api/v1/admin/settings", tokA, map[string]any{"registration": ""})
	_, body = do(t, ts, "GET", "/api/v1/instance", "", nil)
	if body["registration"] != "open" {
		t.Errorf("cleared override falls back to config: %v", body)
	}
}

func TestFriendNickname(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	_, idC := register(t, ts, "carol")
	ga := connectGW(t, ts, tokA)
	friend(t, ts, tokA, "bob", tokB, idA)
	ga.next("relationship_add", 3*time.Second)
	ga.next("relationship_add", 3*time.Second)
	res, body := do(t, ts, "PATCH", "/api/v1/users/@me/relationships/"+idB, tokA, map[string]any{"nickname": "  Bobby  "})
	if res.StatusCode != 200 || body["nickname"] != "Bobby" || body["type"] != "friend" {
		t.Fatalf("nickname: %d %v", res.StatusCode, body)
	}
	if ev := ga.next("relationship_add", 3*time.Second); ev == nil || ev["nickname"] != "Bobby" {
		t.Errorf("nickname event: %v", ev)
	}
	// only friends can be nicknamed; the other side never sees it
	if res, _ = do(t, ts, "PATCH", "/api/v1/users/@me/relationships/"+idC, tokA, map[string]any{"nickname": "x"}); res.StatusCode != 404 {
		t.Error("nickname a stranger")
	}
	_, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokB, nil)
	for _, r := range body["_list"].([]any) {
		if r.(map[string]any)["nickname"] != "" {
			t.Errorf("nickname leaked: %v", r)
		}
	}
}
