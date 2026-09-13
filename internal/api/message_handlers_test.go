package api

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/perms"
)

// A block closes a conversation that already exists, not only the way to start one.
func TestBlockClosesAnExistingDM(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	dm := body["id"].(string)
	createEpoch(t, ts, tokA, dm)
	res, body := sendMsg(t, ts, tokA, dm, dm, 0, "hi", "", nil)
	if res.StatusCode != 201 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	mid := body["id"].(string)
	const thumbs = "/reactions/%F0%9F%91%8D/@me"
	if res, _ := do(t, ts, "PUT", "/api/v1/channels/"+dm+"/messages/"+mid+thumbs, tokB, nil); res.StatusCode != 204 {
		t.Fatalf("react before the block: %d", res.StatusCode)
	}
	res, body = do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", tokA, map[string]any{"name": "plans"})
	if res.StatusCode != 201 {
		t.Fatalf("subchat: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)
	createEpoch(t, ts, tokA, sub)
	ga := connectGW(t, ts, tokA)

	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Fatalf("block: %d", res.StatusCode)
	}
	if res, body := sendMsg(t, ts, tokB, sub, sub, 0, "round the side", "", nil); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("blocked user sends in a subchat: %d %v", res.StatusCode, body)
	}
	if res, body := sendMsg(t, ts, tokB, dm, dm, 0, "still here", "", nil); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("blocked user sends: %d %v", res.StatusCode, body)
	}
	if res, body := sendMsg(t, ts, tokA, dm, dm, 0, "and you", "", nil); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("the blocker sends: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/channels/"+dm+"/messages/"+mid, tokA, map[string]any{"ciphertext": envelopeFor(dm, 0, "edited"), "key_conv_id": dm, "key_epoch": 0}); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("edit: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/typing", tokB, nil); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("typing: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/channels/"+dm+"/messages/"+mid+"/reactions/%E2%9D%A4/@me", tokB, nil); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("react: %d %v", res.StatusCode, body)
	}
	// taking back a reaction made before the block is still fine
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+dm+"/messages/"+mid+thumbs, tokB, nil); res.StatusCode != 204 {
		t.Errorf("unreact: %d", res.StatusCode)
	}
	// typing over the gateway does not reach alice either
	gb := connectGW(t, ts, tokB)
	op, _ := json.Marshal(map[string]any{"op": "typing", "d": map[string]any{"channel_id": dm}})
	if err := gb.ws.Write(context.Background(), websocket.MessageText, op); err != nil {
		t.Fatal(err)
	}
	if ev := ga.next("typing", 500*time.Millisecond); ev != nil {
		t.Errorf("alice sees a blocked user typing: %v", ev)
	}
	// history stays readable
	if res, _ := do(t, ts, "GET", "/api/v1/channels/"+dm+"/messages", tokA, nil); res.StatusCode != 200 {
		t.Errorf("history: %d", res.StatusCode)
	}

	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Fatalf("unblock: %d", res.StatusCode)
	}
	if res, body := sendMsg(t, ts, tokB, dm, dm, 0, "hello again", "", nil); res.StatusCode != 201 {
		t.Errorf("send after unblock: %d %v", res.StatusCode, body)
	}
	_ = idA
}

// An edit sealed under another epoch, or under the conversation the message
// was first sent in, is stored with the key that opens it.
func TestEditKeepsTheKeyThatOpensIt(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	dm := body["id"].(string)
	createEpoch(t, ts, tokA, dm)
	_, body = sendMsg(t, ts, tokA, dm, dm, 0, "hi", "", nil)
	mid := body["id"].(string)
	if e := createEpoch(t, ts, tokA, dm); e != 1 {
		t.Fatalf("second epoch: %d", e)
	}
	res, body := do(t, ts, "PATCH", "/api/v1/channels/"+dm+"/messages/"+mid, tokA, map[string]any{"ciphertext": envelopeFor(dm, 1, "edited"), "key_conv_id": dm, "key_epoch": 1})
	if res.StatusCode != 200 || body["key_epoch"].(float64) != 1 {
		t.Errorf("edit under a newer epoch: %d %v", res.StatusCode, body)
	}
	_, body = do(t, ts, "GET", "/api/v1/channels/"+dm+"/messages/"+mid, tokB, nil)
	if body["key_epoch"].(float64) != 1 {
		t.Errorf("stored epoch: %v", body)
	}

	// a channel that gets its own key keeps older messages editable under the server's
	view := createServer(t, ts, tokA, "Keys")
	sid := view["id"].(string)
	createEpoch(t, ts, tokA, sid)
	res, body = do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tokA, map[string]any{"type": "text", "name": "staff"})
	if res.StatusCode != 201 {
		t.Fatal(body)
	}
	staff := body["id"].(string)
	_, body = sendMsg(t, ts, tokA, staff, sid, 0, "before", "", nil)
	old := body["id"].(string)
	if res, body = do(t, ts, "PUT", "/api/v1/channels/"+staff+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.ViewChannel)}); res.StatusCode != 200 {
		t.Fatalf("make private: %d %v", res.StatusCode, body)
	}
	createEpoch(t, ts, tokA, staff)
	res, body = do(t, ts, "PATCH", "/api/v1/channels/"+staff+"/messages/"+old, tokA, map[string]any{"ciphertext": envelopeFor(sid, 0, "fixed"), "key_conv_id": sid, "key_epoch": 0})
	if res.StatusCode != 200 || body["key_conv_id"] != sid {
		t.Errorf("edit under the message's own conversation: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PATCH", "/api/v1/channels/"+staff+"/messages/"+old, tokA, map[string]any{"ciphertext": envelopeFor(staff, 0, "moved"), "key_conv_id": staff, "key_epoch": 0})
	if res.StatusCode != 200 || body["key_conv_id"] != staff {
		t.Errorf("edit under the channel's own key: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/channels/"+staff+"/messages/"+old, tokA, map[string]any{"ciphertext": envelopeFor(dm, 0, "elsewhere"), "key_conv_id": dm, "key_epoch": 0}); res.StatusCode != 400 || errCode(body) != "wrong_conversation" {
		t.Errorf("edit under an unrelated conversation: %d %v", res.StatusCode, body)
	}
}

// An edit is broadcast without the editor's own reaction flags.
func TestEditBroadcastDoesNotCarryTheEditorsReactions(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	dm := body["id"].(string)
	createEpoch(t, ts, tokA, dm)
	_, body = sendMsg(t, ts, tokA, dm, dm, 0, "hi", "", nil)
	mid := body["id"].(string)
	do(t, ts, "PUT", "/api/v1/channels/"+dm+"/messages/"+mid+"/reactions/%F0%9F%91%8D/@me", tokA, nil)
	gb := connectGW(t, ts, tokB)
	res, body := do(t, ts, "PATCH", "/api/v1/channels/"+dm+"/messages/"+mid, tokA, map[string]any{"ciphertext": envelopeFor(dm, 0, "edited"), "key_conv_id": dm, "key_epoch": 0})
	if res.StatusCode != 200 || body["reactions"].([]any)[0].(map[string]any)["me"] != true {
		t.Fatalf("the editor's own copy: %d %v", res.StatusCode, body)
	}
	ev := gb.next("message_update", 3*time.Second)
	if ev == nil {
		t.Fatal("no message_update")
	}
	if r := ev["reactions"].([]any); len(r) != 1 || r[0].(map[string]any)["me"] != false {
		t.Errorf("bob is told the reaction is his: %v", ev["reactions"])
	}
}

// Only adding a reaction needs Add Reactions.
func TestReactionRoutesNeedOnlyWhatTheyDo(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "Announcements")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	epoch := createEpoch(t, ts, tokA, sid)
	_, body := sendMsg(t, ts, tokA, general, sid, epoch, "news", "", nil)
	mid := body["id"].(string)
	const thumbs = "/reactions/%F0%9F%91%8D"
	base := "/api/v1/channels/" + general + "/messages/" + mid
	if res, _ := do(t, ts, "PUT", base+thumbs+"/@me", tokB, nil); res.StatusCode != 204 {
		t.Fatalf("react: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.AddReactions)}); res.StatusCode != 200 {
		t.Fatalf("deny reactions: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "PUT", base+"/reactions/%E2%9D%A4/@me", tokB, nil); res.StatusCode != 403 {
		t.Errorf("adding still needs Add Reactions: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "GET", base+thumbs, tokB, nil); res.StatusCode != 200 || len(body["_list"].([]any)) != 1 {
		t.Errorf("who reacted: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "DELETE", base+thumbs+"/@me", tokB, nil); res.StatusCode != 204 {
		t.Errorf("taking a reaction back: %d", res.StatusCode)
	}
}

// The same file listed twice in one message is attached once.
func TestDuplicateAttachmentIsAttachedOnce(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	dm := body["id"].(string)
	createEpoch(t, ts, tokA, dm)
	res, raw := rawPost(t, ts.URL+"/api/v1/channels/"+dm+"/attachments", tokA, "application/octet-stream", bytes.Repeat([]byte{7}, 100))
	if res.StatusCode != 201 {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	var up map[string]any
	_ = json.Unmarshal(raw, &up)
	blob := up["blob_id"].(string)
	att := []map[string]any{{"blob_id": blob, "size": 100}, {"blob_id": blob, "size": 100}}
	res, body = sendMsg(t, ts, tokA, dm, dm, 0, "", "", map[string]any{"attachments": att})
	if res.StatusCode != 201 || len(body["attachments"].([]any)) != 1 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	id, _ := parseID(blob)
	if b, err := srv.Store.BlobByID(context.Background(), id); err != nil || b.RefCount != 1 {
		t.Errorf("ref count: %v %+v", err, b)
	}
	do(t, ts, "DELETE", "/api/v1/channels/"+dm+"/messages/"+body["id"].(string), tokA, nil)
	if b, err := srv.Store.BlobByID(context.Background(), id); err != nil || b.RefCount != 0 {
		t.Errorf("ref count after delete: %v %+v", err, b)
	}
	_ = tokB
}
