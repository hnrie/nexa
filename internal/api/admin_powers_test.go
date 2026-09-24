package api

import (
	"testing"

	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
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
	// both servers it owned went with it, the shared one for everyone in it
	if res, _ := do(t, ts, "GET", "/api/v1/servers/"+sid, tokA, nil); res.StatusCode != 404 {
		t.Errorf("shared server after deletion: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/servers/"+sid, tokD, nil); res.StatusCode != 404 {
		t.Errorf("a member still sees the shared server: %d", res.StatusCode)
	}
	_, stats = do(t, ts, "GET", "/api/v1/admin/stats", tokA, nil)
	if stats["servers"].(float64) != serversBefore-2 {
		t.Errorf("servers: before %v after %v", serversBefore, stats["servers"])
	}
	// the account itself stays, as an empty stand-in nobody can sign in as
	if res, u := do(t, ts, "GET", "/api/v1/users/"+idB, tokA, nil); res.StatusCode != 200 || u["display_name"] != "Deleted User" {
		t.Errorf("the deleted account should remain as an anonymous record: %d %v", res.StatusCode, u)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/admin/users/"+idB, tokA, nil); res.StatusCode != 404 {
		t.Errorf("deleting twice: %d", res.StatusCode)
	}
}

func TestInstanceAdminManagesGroupsTheyAreIn(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice") // first account is the admin
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	tokD, idD := register(t, ts, "dave")
	friend(t, ts, tokB, "alice", tokA, idB)
	friend(t, ts, tokB, "carol", tokC, idB)
	friend(t, ts, tokB, "dave", tokD, idB)
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokB, map[string]any{"recipient_ids": []string{idA, idC, idD}, "name": "bob's"})
	if res.StatusCode != 201 || body["owner_id"] != idB {
		t.Fatalf("group: %d %v", res.StatusCode, body)
	}
	g := body["id"].(string)

	// an ordinary member can do none of what the owner does to others
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+g+"/recipients/"+idD, tokC, nil); res.StatusCode != 403 || errCode(body) != "not_owner" {
		t.Errorf("member removing another: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+g, tokC, map[string]any{"owner_id": idC}); res.StatusCode != 403 {
		t.Errorf("member taking ownership: %d %v", res.StatusCode, body)
	}

	// the admin removes members, but not the owner, who outranks her as in a server
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+g+"/recipients/"+idD, tokA, nil); res.StatusCode != 204 {
		t.Errorf("admin removing a member: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+g+"/recipients/"+idB, tokA, nil); res.StatusCode != 403 || errCode(body) != "is_owner" {
		t.Errorf("admin removing the owner: %d %v", res.StatusCode, body)
	}

	// she can hand the group on, after which the old owner is a member like any other
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+g, tokA, map[string]any{"owner_id": idC}); res.StatusCode != 200 || body["owner_id"] != idC {
		t.Fatalf("admin transferring ownership: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+g+"/recipients/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Errorf("admin removing the former owner: %d %v", res.StatusCode, body)
	}

	// subchats in the group are hers to rename, and the group hers to delete
	res, body = do(t, ts, "POST", "/api/v1/channels/"+g+"/subchats", tokC, map[string]any{"name": "carol's corner"})
	if res.StatusCode != 201 {
		t.Fatalf("subchat: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+sub, tokA, map[string]any{"name": "renamed"}); res.StatusCode != 200 || body["name"] != "renamed" {
		t.Errorf("admin renaming a subchat: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "DELETE", "/api/v1/channels/"+g+"?purge=true", tokA, nil); res.StatusCode != 204 {
		t.Errorf("admin deleting the group: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "GET", "/api/v1/channels/"+g, tokC, nil); res.StatusCode != 404 {
		t.Errorf("the group is gone for its owner too: %d", res.StatusCode)
	}

	// a group she is not in stays out of reach
	friend(t, ts, tokC, "dave", tokD, idC)
	res, body = do(t, ts, "POST", "/api/v1/users/@me/channels", tokC, map[string]any{"recipient_ids": []string{idB, idD}})
	if res.StatusCode != 201 {
		t.Fatalf("second group: %d %v", res.StatusCode, body)
	}
	other := body["id"].(string)
	if res, _ = do(t, ts, "DELETE", "/api/v1/channels/"+other+"/recipients/"+idD, tokA, nil); res.StatusCode != 404 {
		t.Errorf("admin outside the group: %d", res.StatusCode)
	}
}

// The configured admin username sets an instance up; once it has an admin,
// the name is an ordinary one — freed by a rename, it cannot be registered
// into admin powers.
func TestTheConfiguredAdminNameIsOnlyForSettingUp(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.Cfg.AdminUsername = "boss"
	ownerTok, _ := register(t, ts, "owner")
	_, me := do(t, ts, "GET", "/api/v1/users/@me", ownerTok, nil)
	if int64(me["flags"].(float64))&store.FlagAdmin == 0 {
		t.Fatal("the first account is the instance's admin")
	}
	bossTok, _ := register(t, ts, "boss")
	_, me = do(t, ts, "GET", "/api/v1/users/@me", bossTok, nil)
	if int64(me["flags"].(float64))&store.FlagAdmin != 0 {
		t.Error("registering the configured name made an admin on a set-up instance")
	}
}
