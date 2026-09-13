package api

import (
	"testing"

	"evilion.xyz/chat/internal/perms"
)

func TestInstanceAdminRunsEveryServerTheyAreIn(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice") // first account is the admin
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")

	view := createServer(t, ts, tokB, "Bob's")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	code := inviteFor(t, ts, tokB, general)
	join(t, ts, tokA, code)
	join(t, ts, tokC, code)
	epoch := createEpoch(t, ts, tokB, sid)

	// no role says so, but she holds every permission
	res, body := do(t, ts, "GET", "/api/v1/servers/"+sid, tokA, nil)
	if res.StatusCode != 200 || body["server"].(map[string]any)["my_permissions"] != permStr(perms.All) {
		t.Fatalf("admin permissions: %d %v", res.StatusCode, body["server"])
	}
	if _, body = do(t, ts, "GET", "/api/v1/servers/"+sid, tokC, nil); body["server"].(map[string]any)["my_permissions"] == permStr(perms.All) {
		t.Fatal("an ordinary member must not hold every permission")
	}

	// she can take down someone else's message; an ordinary member cannot
	res, body = sendMsg(t, ts, tokC, general, sid, epoch, "carol's", "", nil)
	if res.StatusCode != 201 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	carols := body["id"].(string)
	res, body = sendMsg(t, ts, tokA, general, sid, epoch, "alice's", "", nil)
	if res.StatusCode != 201 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	alices := body["id"].(string)
	if res, _ = do(t, ts, "DELETE", "/api/v1/channels/"+general+"/messages/"+alices, tokC, nil); res.StatusCode != 403 {
		t.Errorf("member deleting another's message: %d", res.StatusCode)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+general+"/messages/"+carols, tokA, nil); res.StatusCode != 204 {
		t.Errorf("admin deleting a message: %d %v", res.StatusCode, body)
	}

	// she outranks every member, but not the owner, who can still remove her
	if res, body = do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/members/"+idB, tokA, nil); res.StatusCode != 403 || errCode(body) != "role_hierarchy" {
		t.Errorf("admin kicking the owner: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/members/"+idC, tokA, nil); res.StatusCode != 204 {
		t.Errorf("admin kicking a member: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/members/"+idA, tokB, nil); res.StatusCode != 204 {
		t.Errorf("owner removing the admin: %d %v", res.StatusCode, body)
	}
	// outside a server she is not in, she has nothing
	if res, _ = do(t, ts, "GET", "/api/v1/servers/"+sid, tokA, nil); res.StatusCode != 404 {
		t.Errorf("admin outside the server: %d", res.StatusCode)
	}
}

func TestAdminDeletesAnAccount(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	tokD, _ := register(t, ts, "dave")

	// bob owns a server alice and dave are in, and a server nobody else is in
	shared := createServer(t, ts, tokB, "Shared")
	sid := shared["id"].(string)
	code := inviteFor(t, ts, tokB, channelNamed(shared, "general")["id"].(string))
	join(t, ts, tokD, code)
	join(t, ts, tokA, code)
	createServer(t, ts, tokB, "Alone")
	_, stats := do(t, ts, "GET", "/api/v1/admin/stats", tokA, nil)
	serversBefore := stats["servers"].(float64)

	// what may not be deleted
	if res, body := do(t, ts, "DELETE", "/api/v1/admin/users/"+idA, tokA, nil); res.StatusCode != 400 || errCode(body) != "self" {
		t.Errorf("deleting yourself: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/admin/users/"+idA, tokB, nil); res.StatusCode != 403 {
		t.Errorf("non-admin deleting: %d", res.StatusCode)
	}
	do(t, ts, "PATCH", "/api/v1/admin/users/"+idC, tokA, map[string]any{"admin": true})
	if res, body := do(t, ts, "DELETE", "/api/v1/admin/users/"+idC, tokA, nil); res.StatusCode != 400 || errCode(body) != "is_admin" {
		t.Errorf("deleting another admin: %d %v", res.StatusCode, body)
	}
	_ = tokC

	gb := connectGW(t, ts, tokB)
	if res, body := do(t, ts, "DELETE", "/api/v1/admin/users/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Fatalf("delete: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("session_expired", 3e9); ev == nil {
		t.Error("the deleted account's open session is told to sign out")
	}
	if res, _ := do(t, ts, "GET", "/api/v1/users/@me", tokB, nil); res.StatusCode != 401 {
		t.Errorf("deleted token still works: %d", res.StatusCode)
	}
	// the shared server passes to the admin who did it; the empty one is gone
	res, view := do(t, ts, "GET", "/api/v1/servers/"+sid, tokA, nil)
	if res.StatusCode != 200 || view["server"].(map[string]any)["owner_id"] != idA {
		t.Errorf("shared server after deletion: %d %v", res.StatusCode, view["server"])
	}
	_, members := do(t, ts, "GET", "/api/v1/servers/"+sid+"/members?limit=100", tokA, nil)
	list, _ := members["_list"].([]any)
	if raw, ok := members["members"].([]any); ok {
		list = raw
	}
	if len(list) != 2 {
		t.Errorf("members after deletion: %v", members)
	}
	for _, m := range list {
		if m.(map[string]any)["user_id"] == idB {
			t.Error("the deleted account is still a member")
		}
	}
	_, stats = do(t, ts, "GET", "/api/v1/admin/stats", tokA, nil)
	if stats["servers"].(float64) != serversBefore-1 {
		t.Errorf("servers: before %v after %v", serversBefore, stats["servers"])
	}
	// the account itself stays, anonymised, so what it wrote still has an author
	if res, u := do(t, ts, "GET", "/api/v1/users/"+idB, tokA, nil); res.StatusCode != 200 || u["display_name"] != "Deleted User" {
		t.Errorf("the deleted account should remain as an anonymous record: %d %v", res.StatusCode, u)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/admin/users/"+idB, tokA, nil); res.StatusCode != 404 {
		t.Errorf("deleting twice: %d", res.StatusCode)
	}
}
