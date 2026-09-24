package api

import (
	"testing"
	"time"

	"evilion.xyz/chat/internal/store"
)

// Someone deleting their own account takes everything it made with it, as a
// moderator deleting it would, and their one-to-one conversations too, whole,
// for the people on the other side of them.
func TestDeletingYourOwnAccountTakesEverything(t *testing.T) {
	srv, ts := newTestServer(t)
	ctx := t.Context()
	register(t, ts, "owner")
	vicTok, vicID := register(t, ts, "leaver")
	bobTok, bobID := register(t, ts, "bob")
	carolTok, carolID := register(t, ts, "carol")
	befriend(t, ts, vicTok, bobTok, "bob", vicID)
	befriend(t, ts, vicTok, carolTok, "carol", vicID)
	befriend(t, ts, carolTok, bobTok, "bob", carolID)
	// their server with bob in it, and bob's server with them in it
	mine := createServer(t, ts, vicTok, "leaver's place")["id"].(string)
	if _, err := srv.Store.AddMember(ctx, modID(mine), modID(bobID)); err != nil {
		t.Fatal(err)
	}
	theirs := createServer(t, ts, bobTok, "bob's place")["id"].(string)
	if _, err := srv.Store.AddMember(ctx, modID(theirs), modID(vicID)); err != nil {
		t.Fatal(err)
	}
	// carol's group with them in it, and a DM with bob with both of them talking
	_, grp := do(t, ts, "POST", "/api/v1/users/@me/channels", carolTok, map[string]any{"recipient_ids": []string{vicID, bobID}, "name": "carol's gang"})
	group := grp["id"].(string)
	createEpoch(t, ts, carolTok, group)
	_, d := do(t, ts, "POST", "/api/v1/users/@me/channels", vicTok, map[string]any{"recipient_ids": []string{bobID}})
	dm := d["id"].(string)
	createEpoch(t, ts, vicTok, dm)
	if res, body := sendMsg(t, ts, vicTok, dm, dm, 0, "from them", "", nil); res.StatusCode != 201 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	_, b := sendMsg(t, ts, bobTok, dm, dm, 0, "from bob", "", nil)
	bobMsg := b["id"].(string)
	if res, body := sendMsg(t, ts, vicTok, group, group, 0, "in carol's group", "", nil); res.StatusCode != 201 {
		t.Fatalf("send to group: %d %v", res.StatusCode, body)
	}
	_, c := sendMsg(t, ts, carolTok, group, group, 0, "carol's own words", "", nil)
	carolMsg := c["id"].(string)
	if res, _ := do(t, ts, "PUT", "/api/v1/channels/"+group+"/messages/"+carolMsg+"/reactions/%F0%9F%91%8D/@me", vicTok, nil); res.StatusCode != 204 {
		t.Fatal("react")
	}

	// what it would take, before asking: accepting a friend opens a DM, so
	// there is one with carol as well as the one with bob
	_, preview := do(t, ts, "GET", "/api/v1/users/@me/delete-preview", vicTok, nil)
	if preview["messages"].(float64) != 2 || preview["owned_servers"].(float64) != 1 || preview["direct_messages"].(float64) != 2 || preview["groups"].(float64) != 1 || preview["reactions"].(float64) != 1 {
		t.Errorf("preview: %v", preview)
	}

	bobGW := connectGW(t, ts, bobTok)
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/delete", vicTok, map[string]any{"auth_key": b64(key32)}); res.StatusCode != 204 {
		t.Fatalf("delete: %d %v", res.StatusCode, body)
	}

	// signed out for good, with nothing of the account left but its stand-in
	if res, _ := do(t, ts, "GET", "/api/v1/users/@me", vicTok, nil); res.StatusCode != 401 {
		t.Errorf("their session still works: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/auth/login", "", map[string]any{"username": "leaver", "auth_key": b64(key32)}); res.StatusCode != 401 {
		t.Errorf("they can still sign in: %d", res.StatusCode)
	}
	u, _ := srv.Store.UserByID(ctx, modID(vicID))
	if u.Flags&store.FlagDeleted == 0 || u.Username == "leaver" || u.DisplayName != "Deleted User" {
		t.Errorf("account row: %+v", u)
	}
	// their server went, for everyone in it; they left bob's
	if _, err := srv.Store.ServerByID(ctx, modID(mine)); err == nil {
		t.Error("their server survived")
	}
	if ok, _ := srv.Store.IsMember(ctx, modID(theirs), modID(vicID)); ok {
		t.Error("still in bob's server")
	}
	// the DM went whole, bob's words with it, and bob heard
	if _, err := srv.Store.ChannelByID(ctx, modID(dm)); err == nil {
		t.Error("the DM survived")
	}
	if _, err := srv.Store.MessageByID(ctx, modID(bobMsg), modID(bobID)); err == nil {
		t.Error("bob's side of the DM survived")
	}
	gone := map[string]bool{}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ev := bobGW.next("channel_delete", 300*time.Millisecond)
		if ev == nil {
			break
		}
		gone[ev["id"].(string)] = true
	}
	if !gone[dm] {
		t.Errorf("bob was not told the DM went: %v", gone)
	}
	// carol's group stays for carol, with her words and none of theirs
	if ok, _ := srv.Store.IsParticipant(ctx, modID(group), modID(vicID)); ok {
		t.Error("still in carol's group")
	}
	if _, err := srv.Store.MessageByID(ctx, modID(carolMsg), modID(carolID)); err != nil {
		t.Errorf("carol's own message went: %v", err)
	}
	var n int
	_ = srv.Store.DB().R.QueryRow(`SELECT count(*) FROM messages WHERE author_id = ?`, modID(vicID)).Scan(&n)
	if n != 0 {
		t.Errorf("%d of their messages survived", n)
	}
	_ = srv.Store.DB().R.QueryRow(`SELECT count(*) FROM reactions WHERE user_id = ?`, modID(vicID)).Scan(&n)
	if n != 0 {
		t.Errorf("%d of their reactions survived", n)
	}
	// and there is nothing for the sweep to find
	left, err := srv.Store.DeletedAccountsWithLeftovers(ctx)
	if err != nil || len(left) != 0 {
		t.Errorf("leftovers after deleting: %v %v", left, err)
	}
}

// Accounts deleted before deletion took everything, or whose deletion
// stopped part way, are finished by the sweep; one a moderator deleted keeps
// its one-to-one conversations for the people on the other side of them.
func TestTheSweepFinishesDeletedAccounts(t *testing.T) {
	srv, ts := newTestServer(t)
	ctx := t.Context()
	modTok, _ := register(t, ts, "owner")
	oldTok, oldID := register(t, ts, "oldtimer")
	modVicTok, modVicID := register(t, ts, "moderated")
	bobTok, bobID := register(t, ts, "bob")
	befriend(t, ts, oldTok, bobTok, "bob", oldID)
	befriend(t, ts, modVicTok, bobTok, "bob", modVicID)
	dmOld := dmBetween(t, ts, oldTok, bobID)
	createEpoch(t, ts, oldTok, dmOld)
	sendMsg(t, ts, oldTok, dmOld, dmOld, 0, "old words", "", nil)
	sendMsg(t, ts, bobTok, dmOld, dmOld, 0, "bob to the old one", "", nil)
	dmMod := dmBetween(t, ts, modVicTok, bobID)
	createEpoch(t, ts, modVicTok, dmMod)
	sendMsg(t, ts, modVicTok, dmMod, dmMod, 0, "moderated words", "", nil)
	_, kept := sendMsg(t, ts, bobTok, dmMod, dmMod, 0, "bob to the moderated one", "", nil)

	// deleted the way it used to be: the profile gone, everything else left
	if err := srv.Store.DeleteAccount(ctx, modID(oldID)); err != nil {
		t.Fatal(err)
	}
	// a moderator's deletion that stopped after it was recorded
	mustAct(t, ts, modTok, modVicID, map[string]any{"action": "delete", "reason": "spam", "confirm": "moderated"})
	before, _ := srv.Store.DeletedAccountsWithLeftovers(ctx)
	if len(before) != 1 || before[0] != modID(oldID) {
		t.Fatalf("leftovers before the sweep: %v", before)
	}

	srv.finishDeletedAccounts(ctx)

	var n int
	_ = srv.Store.DB().R.QueryRow(`SELECT count(*) FROM messages WHERE author_id = ?`, modID(oldID)).Scan(&n)
	if n != 0 {
		t.Errorf("%d of the old account's messages survived", n)
	}
	if _, err := srv.Store.ChannelByID(ctx, modID(dmOld)); err == nil {
		t.Error("the old account's DM survived")
	}
	// the moderated account's DM stays for bob, with his words
	if _, err := srv.Store.ChannelByID(ctx, modID(dmMod)); err != nil {
		t.Errorf("the moderated account's DM went: %v", err)
	}
	if _, err := srv.Store.MessageByID(ctx, modID(kept["id"].(string)), modID(bobID)); err != nil {
		t.Errorf("bob's words to the moderated account went: %v", err)
	}
	if left, err := srv.Store.DeletedAccountsWithLeftovers(ctx); err != nil || len(left) != 0 {
		t.Errorf("leftovers after the sweep: %v %v", left, err)
	}
}
