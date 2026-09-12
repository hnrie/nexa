package api

import (
	"testing"
	"time"
)

func TestFriendRequestsAndBlocks(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	gb := connectGW(t, ts, tokB)
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "alice"}); res.StatusCode != 400 || errCode(body) != "self" {
		t.Errorf("self: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "ghost"}); res.StatusCode != 404 {
		t.Errorf("unknown: %d %v", res.StatusCode, body)
	}
	res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "Bob"})
	if res.StatusCode != 200 || body["type"] != "outgoing" {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "incoming" || ev["user"].(map[string]any)["id"] != idA {
		t.Errorf("bob sees incoming: %v", ev)
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 400 || errCode(body) != "already_sent" {
		t.Errorf("duplicate: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokB, nil)
	list := body["_list"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["type"] != "incoming" {
		t.Errorf("bob list: %v", body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idC, tokB, nil); res.StatusCode != 404 {
		t.Errorf("accept nonexistent: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idA, tokB, nil); res.StatusCode != 200 || body["type"] != "friend" {
		t.Fatalf("accept: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "friend" {
		t.Errorf("bob sees friend: %v", ev)
	}
	// reciprocal request auto-accepts
	do(t, ts, "POST", "/api/v1/users/@me/relationships", tokC, map[string]any{"username": "bob"})
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "carol"}); res.StatusCode != 200 || body["type"] != "friend" {
		t.Errorf("reciprocal: %d %v", res.StatusCode, body)
	}
	// mutual friends: alice and carol share bob
	do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "carol"})
	do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idA, tokC, nil)
	res, body = do(t, ts, "GET", "/api/v1/users/"+idC+"/profile", tokA, nil)
	if mf := body["mutual_friends"].([]any); len(mf) != 1 || mf[0] != idB {
		t.Errorf("mutual friends: %v", body)
	}
	// remove friend
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/relationships/"+idC, tokA, nil); res.StatusCode != 204 {
		t.Error("remove")
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokC, nil)
	for _, it := range body["_list"].([]any) {
		if it.(map[string]any)["user"].(map[string]any)["id"] == idA {
			t.Error("carol should no longer list alice")
		}
	}
	// block
	if res, _ = do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Error("block")
	}
	if ev := gb.next("relationship_remove", 3*time.Second); ev == nil || ev["user_id"] != idA {
		t.Errorf("bob loses the friendship: %v", ev)
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "alice"}); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("blocked request: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokA, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["type"] != "blocked" {
		t.Errorf("alice list: %v", body)
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/relationships/"+idB, tokA, nil); res.StatusCode != 404 {
		t.Error("blocked rows are not removed via relationships delete")
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Error("unblock")
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "alice"}); res.StatusCode != 200 || body["type"] != "outgoing" {
		t.Errorf("request after unblock: %d %v", res.StatusCode, body)
	}
}
