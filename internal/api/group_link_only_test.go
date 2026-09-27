package api

import (
	"testing"
	"time"
)

// "Let friends add me to group chats" is stored on the account, told to
// friends (who draw the Link Only label from it), and kept live through
// user_update, off as well as on.
func TestGroupLinkOnlySetting(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	friend(t, ts, tokA, "bob", tokB, idA)

	if _, me := do(t, ts, "GET", "/api/v1/users/@me", tokB, nil); me["group_link_only"] != false {
		t.Fatalf("friends may add a new account to groups: %v", me["group_link_only"])
	}
	for _, bad := range []any{"yes", nil, 1} {
		if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"group_link_only": bad}); res.StatusCode != 400 || errCode(body) != "invalid_group_link_only" {
			t.Errorf("group_link_only %v: %d %v", bad, res.StatusCode, body)
		}
	}

	ga := connectGW(t, ts, tokA)
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"group_link_only": true}); res.StatusCode != 200 || body["group_link_only"] != true {
		t.Fatalf("turn it off: %d %v", res.StatusCode, body)
	}
	if ev := ga.nextFor("user_update", "id", idB, 3*time.Second); ev == nil || ev["group_link_only"] != true {
		t.Errorf("a friend should hear bob is Link Only: %v", ev)
	}
	if _, body := do(t, ts, "GET", "/api/v1/users/"+idB, tokA, nil); body["group_link_only"] != true {
		t.Errorf("bob's profile: %v", body)
	}
	ready := connectGWReady(t, ts, tokA).ready
	found := false
	for _, r := range ready["relationships"].([]any) {
		u := r.(map[string]any)["user"].(map[string]any)
		if u["id"] == idB {
			found = u["group_link_only"] == true
		}
	}
	if !found {
		t.Error("ready should carry bob as Link Only")
	}

	// turned back on, the change is sent as false rather than left out
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"group_link_only": false}); res.StatusCode != 200 || body["group_link_only"] != false {
		t.Fatalf("turn it back on: %d %v", res.StatusCode, body)
	}
	if ev := ga.nextFor("user_update", "id", idB, 3*time.Second); ev == nil || ev["group_link_only"] != false {
		t.Errorf("a friend should hear bob can be added again: %v", ev)
	}
}

// Nobody puts a Link Only account in a group, new or old; a link it is sent
// always works.
func TestLinkOnlyJoinsOnlyByLink(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	tokD, idD := register(t, ts, "dave")
	friend(t, ts, tokA, "bob", tokB, idA)
	friend(t, ts, tokA, "carol", tokC, idA)
	friend(t, ts, tokA, "dave", tokD, idA)
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokC, map[string]any{"group_link_only": true}); res.StatusCode != 200 {
		t.Fatalf("carol goes Link Only: %d %v", res.StatusCode, body)
	}

	if res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB, idC}}); res.StatusCode != 403 || errCode(body) != "link_only" {
		t.Fatalf("a new group with carol in it: %d %v", res.StatusCode, body)
	}
	// a direct message is not a group (friends already share one)
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idC}}); res.StatusCode >= 300 || body["type"] != "dm" {
		t.Errorf("a DM with carol: %d %v", res.StatusCode, body)
	}
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB, idD}, "name": "pals"})
	if res.StatusCode != 201 || body["type"] != "group_dm" {
		t.Fatalf("group: %d %v", res.StatusCode, body)
	}
	g := body["id"].(string)
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+g+"/recipients/"+idC, tokB, nil); res.StatusCode != 403 || errCode(body) != "not_friends" {
		t.Errorf("bob is not carol's friend: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+g+"/recipients/"+idC, tokA, nil); res.StatusCode != 403 || errCode(body) != "link_only" {
		t.Errorf("adding carol: %d %v", res.StatusCode, body)
	}
	if _, body := do(t, ts, "GET", "/api/v1/channels/"+g, tokA, nil); len(body["recipient_ids"].([]any)) != 3 {
		t.Errorf("carol should not be in: %v", body["recipient_ids"])
	}

	code := inviteFor(t, ts, tokA, g)
	if res, body := do(t, ts, "POST", "/api/v1/invites/"+code, tokC, nil); res.StatusCode != 201 {
		t.Fatalf("carol joins from the link: %d %v", res.StatusCode, body)
	}
	if _, body := do(t, ts, "GET", "/api/v1/channels/"+g, tokC, nil); len(body["recipient_ids"].([]any)) != 4 {
		t.Errorf("carol should be in now: %v", body["recipient_ids"])
	}
	// and friends who can be added still can
	tokE, idE := register(t, ts, "erin")
	friend(t, ts, tokA, "erin", tokE, idA)
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+g+"/recipients/"+idE, tokA, nil); res.StatusCode != 200 {
		t.Errorf("erin can be added: %d %v", res.StatusCode, body)
	}
	// nobody added her, so Nexa has nothing to tell her
	if n := connectGWReady(t, ts, tokC).ready["group_add_notices"].([]any); len(n) != 0 {
		t.Errorf("carol joined by herself: %v", n)
	}
}

// Someone a friend puts in a group hears it from Nexa, alone: in the ready of
// their own devices and live, until they dismiss it on any of them.
func TestGroupAddNotice(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, _ := register(t, ts, "carol")
	tokD, idD := register(t, ts, "dave")
	tokE, idE := register(t, ts, "erin")
	friend(t, ts, tokA, "bob", tokB, idA)
	friend(t, ts, tokA, "dave", tokD, idA)
	friend(t, ts, tokA, "erin", tokE, idA)

	// made with bob in it: bob was added by alice
	gb := connectGW(t, ts, tokB)
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB, idE}})
	g := body["id"].(string)
	if ev := gb.nextFor("group_add_notice", "channel_id", g, 3*time.Second); ev == nil || ev["added_by"] != idA || ev["added_at"] == nil {
		t.Errorf("bob's note: %v", ev)
	}

	// added later: only dave hears about it
	ga := connectGW(t, ts, tokA)
	gd := connectGW(t, ts, tokD)
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+g+"/recipients/"+idD, tokA, nil); res.StatusCode != 200 {
		t.Fatalf("add dave: %d %v", res.StatusCode, body)
	}
	if ev := gd.nextFor("group_add_notice", "channel_id", g, 3*time.Second); ev == nil || ev["added_by"] != idA {
		t.Errorf("dave's note: %v", ev)
	}
	if ev := gb.next("group_add_notice", 300*time.Millisecond); ev != nil {
		t.Errorf("bob must not hear about dave's note: %v", ev)
	}
	if ev := ga.next("group_add_notice", 300*time.Millisecond); ev != nil {
		t.Errorf("alice must not hear about dave's note: %v", ev)
	}
	notices := func(tok string) []any {
		t.Helper()
		return connectGWReady(t, ts, tok).ready["group_add_notices"].([]any)
	}
	if n := notices(tokD); len(n) != 1 || n[0].(map[string]any)["channel_id"] != g || n[0].(map[string]any)["added_by"] != idA {
		t.Errorf("dave's ready: %v", n)
	}
	if n := notices(tokA); len(n) != 0 {
		t.Errorf("alice made the group and added nobody who told her: %v", n)
	}

	// a stranger to the group cannot touch it, and learns nothing
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+g+"/add-notice", tokC, nil); res.StatusCode != 404 {
		t.Errorf("carol dismissing in a group she is not in: %d", res.StatusCode)
	}
	// dismissed on one device, gone on the others and for good
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+g+"/add-notice", tokD, nil); res.StatusCode != 204 {
		t.Fatalf("dismiss: %d", res.StatusCode)
	}
	if ev := gd.nextFor("group_add_notice_delete", "channel_id", g, 3*time.Second); ev == nil {
		t.Error("dave's other devices should drop the note")
	}
	if n := notices(tokD); len(n) != 0 {
		t.Errorf("dismissed, still in ready: %v", n)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+g+"/add-notice", tokD, nil); res.StatusCode != 204 {
		t.Errorf("dismissing again: %d", res.StatusCode)
	}
	if n := notices(tokB); len(n) != 1 {
		t.Errorf("bob's note is his own to dismiss: %v", n)
	}

	// out and added again: a new note for a new add
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+g+"/recipients/"+idD, tokA, nil); res.StatusCode != 204 {
		t.Fatalf("remove dave: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+g+"/recipients/"+idD, tokA, nil); res.StatusCode != 200 {
		t.Fatalf("add dave again: %d %v", res.StatusCode, body)
	}
	if n := notices(tokD); len(n) != 1 {
		t.Errorf("added again: %v", n)
	}
}
