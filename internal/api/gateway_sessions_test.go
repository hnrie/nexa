package api

import (
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

// gwClosed reports whether the server closes the connection within a few seconds.
func gwClosed(g *gw) bool {
	select {
	case <-g.done:
		return true
	case <-time.After(3 * time.Second):
		return false
	}
}

func TestEndedSessionsLoseTheirSocket(t *testing.T) {
	_, ts := newTestServer(t)
	tok1, _ := register(t, ts, "alice")
	login := func() string {
		_, body := do(t, ts, "POST", "/api/v1/auth/login", "", map[string]any{"username": "alice", "auth_key": b64(key32)})
		return body["token"].(string)
	}
	tok2 := login()
	g1 := connectGW(t, ts, tok1)
	g2 := connectGW(t, ts, tok2)

	// revoking a device under Sessions disconnects it
	_, body := do(t, ts, "GET", "/api/v1/auth/sessions", tok1, nil)
	var otherID string
	for _, it := range body["_list"].([]any) {
		if m := it.(map[string]any); m["current"] != true {
			otherID = m["id"].(string)
		}
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/auth/sessions/"+otherID, tok1, nil); res.StatusCode != 204 {
		t.Fatalf("delete session: %d", res.StatusCode)
	}
	if !gwClosed(g2) {
		t.Error("the revoked session's socket must close")
	}

	// a password change disconnects every other device, not this one
	g3 := connectGW(t, ts, login())
	res, body := do(t, ts, "POST", "/api/v1/auth/password", tok1, map[string]any{"auth_key": b64(key32), "new_auth_key": b64(key32b), "new_enc_private_key": b64([]byte("rewrapped"))})
	if res.StatusCode != 204 {
		t.Fatalf("password change: %d %v", res.StatusCode, body)
	}
	if !gwClosed(g3) {
		t.Error("other devices must be disconnected after a password change")
	}
	g1.op(t, "heartbeat", nil)
	if g1.next("heartbeat_ack", 3*time.Second) == nil {
		t.Error("the device that changed the password stays connected")
	}

	// logging out closes the socket too
	if res, _ := do(t, ts, "POST", "/api/v1/auth/logout", tok1, nil); res.StatusCode != 204 {
		t.Fatal("logout")
	}
	if !gwClosed(g1) {
		t.Error("a logged-out session's socket must close")
	}
}

func TestGatewayTypingNeedsSendPermission(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokC, idC := register(t, ts, "carol")
	view := createServer(t, ts, tokA, "Quiet")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokC, inviteFor(t, ts, tokA, general))
	ga := connectGW(t, ts, tokA)
	gc := connectGW(t, ts, tokC)

	if res, body := do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/roles/"+sid, tokA, map[string]any{"permissions": permStr(perms.DefaultEveryone &^ perms.SendMessages)}); res.StatusCode != 200 {
		t.Fatalf("edit everyone perms: %d %v", res.StatusCode, body)
	}
	gc.op(t, "typing", map[string]string{"channel_id": general})
	if ev := ga.next("typing", 500*time.Millisecond); ev != nil {
		t.Errorf("typing from a member who cannot send must be dropped: %v", ev)
	}
	if res, _ := do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/roles/"+sid, tokA, map[string]any{"permissions": permStr(perms.DefaultEveryone)}); res.StatusCode != 200 {
		t.Fatal("restore everyone perms")
	}
	gc.op(t, "typing", map[string]string{"channel_id": general})
	if ev := ga.next("typing", 3*time.Second); ev == nil || ev["user_id"] != idC {
		t.Errorf("typing once allowed to send: %v", ev)
	}
}
